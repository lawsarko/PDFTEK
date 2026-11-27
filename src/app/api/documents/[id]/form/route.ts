import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { docAccess } from "@/lib/documents";
import { aiConfigured } from "@/lib/ai";
import { get } from "@/lib/db";
import { draftFor, listProfiles, saveDraft, saveTemplate, templateFor } from "@/lib/form-store";
import { FieldSchema, ValuesSchema } from "@/lib/form-schemas";

type P = { params: Promise<{ id: string }> };

/** Everything the form filler needs to open a document. */
export const GET = route<P>(async (_req, { params }) => {
  const { ctx, doc } = await docAccess((await params).id);
  const template = await templateFor(doc);
  const month = new Date().toISOString().slice(0, 7);
  const free = get<{ document_id: string }>("SELECT document_id FROM form_free_uses WHERE workspace_id = ? AND month = ?", ctx.workspace.id, month);
  return json({
    document: { id: doc.id, name: doc.name, pageCount: doc.page_count, versionId: doc.current_version_id },
    template,
    draft: draftFor(doc.id, ctx.user.id),
    profiles: listProfiles(ctx.user.id),
    ai: { available: aiConfigured(), freeForm: !free || free.document_id === doc.id },
  });
});

/** Saves the field layout after adding, moving, relabelling or removing fields. */
export const PATCH = route<P>(async (req, { params }) => {
  const { doc } = await docAccess((await params).id);
  const { fields } = await body(req, z.object({ fields: z.array(FieldSchema).max(2000) }));
  const cur = await templateFor(doc);
  return json({ template: saveTemplate(doc, { fields, summary: cur.summary, acro: cur.acro, detectedBy: cur.detectedBy === "pdf" ? "manual" : cur.detectedBy }) });
});

/** Autosaves answers in progress. */
export const PUT = route<P>(async (req, { params }) => {
  const { ctx, doc } = await docAccess((await params).id);
  const input = await body(req, z.object({ values: ValuesSchema, profileId: z.string().max(40).nullable() }));
  const t = await templateFor(doc);
  saveDraft(doc.id, ctx.user.id, t.fields, input.values, input.profileId);
  return json({ ok: true });
});
