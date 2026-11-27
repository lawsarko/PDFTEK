import { badRequest, json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { isProvider, upload } from "@/lib/cloud";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ provider: string }> };

const MAX = 100 * 1024 * 1024;

/**
 * Saves to the person's cloud storage, in a "pdftek" folder. Either a library document (JSON
 * { documentId }) or a file made in the browser, such as a Word or Excel conversion (multipart: file).
 */
export const POST = route<P>(async (req, { params }) => {
  const { provider } = await params;
  if (!isProvider(provider)) throw badRequest("Unknown service.");
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const user = await requireUser();
    const form = await req.formData();
    const f = form.get("file");
    if (!f || typeof f === "string") throw badRequest("No file to save.");
    if (f.size > MAX) throw badRequest("This file is too large to save to the cloud from here.");
    const name = (typeof form.get("name") === "string" ? (form.get("name") as string) : f.name).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 180) || "Document";
    const r = await upload(user.id, provider, name, Buffer.from(await f.arrayBuffer()), f.type || "application/octet-stream");
    return json(r);
  }
  const { documentId } = (await req.json()) as { documentId?: string };
  if (!documentId) throw badRequest("Choose a document to save.");
  const { ctx, doc } = await docAccess(documentId);
  const pdf = await readCurrentPdf(doc);
  const name = /\.pdf$/i.test(doc.name) ? doc.name : `${doc.name}.pdf`;
  const r = await upload(ctx.user.id, provider, name, pdf, "application/pdf");
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "saved_to_cloud", documentId: doc.id, meta: { provider } });
  return json(r);
});
