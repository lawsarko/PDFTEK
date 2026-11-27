import { badRequest, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { createDocument } from "@/lib/documents";
import { priorYearChecklist } from "@/lib/client-ai";
import { assertFileSize } from "@/lib/billing";

type P = { params: Promise<{ wid: string }> };

/** Reads last year's return (uploaded now, or already in the library) and suggests this year's checklist. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await firmCtx(wid);
  const form = await req.formData();
  let docId = String(form.get("documentId") ?? "");
  const file = form.get("file");
  if (!docId) {
    if (!(file instanceof File)) throw badRequest("Upload last year's return (PDF).");
    assertFileSize(ctx, file.size, file.name);
    const doc = await createDocument({ workspaceId: wid, userId: ctx.user.id, name: file.name, data: Buffer.from(await file.arrayBuffer()), tags: ["prior-year return"] });
    docId = doc.id;
  }
  return json({ documentId: docId, ...(await priorYearChecklist(ctx, docId)) });
});
