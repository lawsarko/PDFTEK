import { z } from "zod";
import { all, insert } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { requireMembership } from "@/lib/billing";
import { getDocument } from "@/lib/documents";
import { templateDTO, validateTemplate, type TemplateRow } from "@/lib/esign";
import { logActivity } from "@/lib/activity";
import { TemplateInput } from "@/lib/esign-schema";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const rows = all<TemplateRow>("SELECT * FROM sign_templates WHERE workspace_id = ? ORDER BY updated_at DESC", wid);
  return json({ templates: rows.map(templateDTO) });
});

/** Saves a template from a document: signer roles and the fields each role fills. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  requireMembership(ctx, "E-signature templates");
  const input = await body(req, TemplateInput.extend({ documentId: z.string() }));
  const doc = getDocument(ctx, input.documentId);
  const roles = input.roles.map((r) => ({ key: r.key, label: r.label, ...(r.name ? { name: r.name } : {}), ...(r.email ? { email: r.email } : {}) }));
  validateTemplate(roles, input.fields, doc.page_count);
  const tid = id("stp_");
  insert("sign_templates", {
    id: tid,
    workspace_id: wid,
    name: input.name,
    document_id: doc.id,
    version_id: doc.current_version_id,
    page_count: doc.page_count,
    title: input.title,
    message: input.message,
    sequential: input.sequential ? 1 : 0,
    roles_json: JSON.stringify(roles),
    fields_json: JSON.stringify(input.fields),
    created_by: ctx.user.id,
    created_at: now(),
    updated_at: now(),
  });
  logActivity({ workspaceId: wid, userId: ctx.user.id, action: "template_created", documentId: doc.id, meta: { name: input.name } });
  const { getTemplate } = await import("@/lib/esign");
  return json({ template: templateDTO(getTemplate(wid, tid)) });
});
