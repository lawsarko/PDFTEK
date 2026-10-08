import { get } from "@/lib/db";
import { json, route, badRequest, notFound } from "@/lib/http";
import { metered, requireMembership } from "@/lib/billing";
import { addVersion, assertCanEdit, docAccess, listVersions, serializeDoc, getDocument, type VersionRow } from "@/lib/documents";
import { readFile } from "@/lib/storage";
import { PDFDocument } from "pdf-lib";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  return json({ versions: listVersions(doc.id) });
});

/**
 * Saves a new version. Either multipart (file + note + kind) from the in-browser editor,
 * or JSON { restore: versionId } to roll back.
 */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  assertCanEdit(doc, ctx.user.id);

  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const { restore } = (await req.json()) as { restore?: string };
    const v = get<VersionRow>("SELECT * FROM document_versions WHERE id = ? AND document_id = ?", restore, doc.id);
    if (!v) throw notFound("Version not found.");
    await addVersion({ doc, userId: ctx.user.id, pdf: await readFile(v.storage_key), note: `Restored v${v.version}` });
  } else {
    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "edit");
    const note = String(form.get("note") ?? "Edited").slice(0, 200);
    if (!(file instanceof File)) throw badRequest("Missing file.");
    if (kind === "edit") requireMembership(ctx, "Editing");
    const data = Buffer.from(await file.arrayBuffer());
    try {
      await PDFDocument.load(data, { updateMetadata: false });
    } catch {
      throw badRequest("The edited file isn't a valid PDF.");
    }
    // Edits are covered by the membership; other in-browser tools (OCR) count as a task.
    if (kind === "edit") await addVersion({ doc, userId: ctx.user.id, pdf: data, note });
    else await metered(ctx, req, kind, () => addVersion({ doc, userId: ctx.user.id, pdf: data, note }));
  }
  const fresh = getDocument(ctx, id);
  return json({ document: serializeDoc(fresh), versions: listVersions(id) });
});
