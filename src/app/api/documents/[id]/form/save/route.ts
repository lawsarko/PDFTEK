import { z } from "zod";
import { body, json, route, HttpError } from "@/lib/http";
import { createDocument, docAccess, readCurrentPdf, serializeDoc } from "@/lib/documents";
import { metered } from "@/lib/billing";
import { buildFilledPdf } from "@/lib/form-pdf";
import { templateFor } from "@/lib/form-store";
import { ValuesSchema } from "@/lib/form-schemas";
import { logActivity } from "@/lib/activity";
import { run } from "@/lib/db";

type P = { params: Promise<{ id: string }> };

const Input = z.object({
  values: ValuesSchema,
  signatures: z.record(z.string().max(40), z.string().max(600_000)).default({}),
  flatten: z.boolean().default(true),
  name: z.string().trim().max(200).optional(),
});

/** Writes the answers into a new PDF next to the blank form, which stays reusable. Counts as one task. */
export const POST = route<P>(async (req, { params }) => {
  const { ctx, doc } = await docAccess((await params).id);
  const input = await body(req, Input);
  const template = await templateFor(doc);
  if (!template.fields.length) throw new HttpError(400, "This form has no fields to fill.");
  const filled = await metered(ctx, req, "Fill form", async () => {
    const pdf = await buildFilledPdf(await readCurrentPdf(doc), template.fields, input.values, { flatten: input.flatten, signatures: input.signatures });
    const base = (input.name || doc.name).replace(/\.pdf$/i, "");
    return createDocument({ workspaceId: ctx.workspace.id, userId: ctx.user.id, name: `${base} (filled).pdf`, data: pdf, tags: ["filled form"] });
  });
  // The draft has done its job.
  run("DELETE FROM form_drafts WHERE document_id = ? AND user_id = ?", doc.id, ctx.user.id);
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "form_filled", documentId: filled.id, meta: { from: doc.name } });
  return json({ document: serializeDoc(filled) });
});
