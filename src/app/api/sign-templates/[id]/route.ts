import { get, run, update } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, notFound, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { requireMembership } from "@/lib/billing";
import { getTemplate, templateDTO, validateTemplate } from "@/lib/esign";
import { TemplateInput } from "@/lib/esign-schema";

type P = { params: Promise<{ id: string }> };

async function access(templateId: string) {
  const row = get<{ workspace_id: string }>("SELECT workspace_id FROM sign_templates WHERE id = ?", templateId);
  if (!row) throw notFound("Template not found.");
  const ctx = await requireMember(row.workspace_id);
  return { ctx, template: getTemplate(row.workspace_id, templateId) };
}

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { template } = await access(id);
  return json({ template: templateDTO(template) });
});

/** Updates a template's name, message, roles and fields (envelopes already sent are unaffected). */
export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, template } = await access(id);
  requireMembership(ctx, "E-signature templates");
  const input = await body(req, TemplateInput);
  const roles = input.roles.map((r) => ({ key: r.key, label: r.label, ...(r.name ? { name: r.name } : {}), ...(r.email ? { email: r.email } : {}) }));
  validateTemplate(roles, input.fields, template.page_count);
  update("sign_templates", template.id, {
    name: input.name,
    title: input.title,
    message: input.message,
    sequential: input.sequential ? 1 : 0,
    roles_json: JSON.stringify(roles),
    fields_json: JSON.stringify(input.fields),
    updated_at: now(),
  });
  return json({ template: templateDTO(getTemplate(template.workspace_id, template.id)) });
});

/** Deletes a template and turns off its signing links. Sent envelopes and signed copies are kept. */
export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { template } = await access(id);
  run("DELETE FROM sign_templates WHERE id = ?", template.id);
  return json({ ok: true });
});
