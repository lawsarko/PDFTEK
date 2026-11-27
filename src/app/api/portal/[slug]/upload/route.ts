import { badRequest, clientIp, json, route } from "@/lib/http";
import { clientRequest, requireClient } from "@/lib/client-portal";
import { uploadItem } from "@/lib/requests";
import { createDocument } from "@/lib/documents";
import { insert } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { notify } from "@/lib/activity";
import { normalizeToPdf, mergePdfs } from "@/lib/pdf";
import { seasonYear } from "@/lib/client-shared";

type P = { params: Promise<{ slug: string }> };

/** Upload for a checklist item, or (without one) any other document for the firm. */
export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { client } = await requireClient(slug);
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const requestId = String(form.get("requestId") ?? "");
  if (requestId) {
    const r = clientRequest(client, requestId);
    return json({ item: await uploadItem(r, String(form.get("itemId") ?? ""), files, clientIp(req)) });
  }
  if (!files.length) throw badRequest("Choose a file to upload.");
  if (files.length > 10) throw badRequest("Upload up to 10 files at a time.");
  const label = String(form.get("label") ?? "").trim().slice(0, 120) || "Other document";
  const year = Number(form.get("year")) || seasonYear();
  const pdfs: Buffer[] = [];
  for (const f of files) {
    if (f.size > 60 * 1024 * 1024) throw badRequest(`${f.name} is larger than 60 MB.`);
    pdfs.push((await normalizeToPdf(f.name, Buffer.from(await f.arrayBuffer()))).pdf);
  }
  const doc = await createDocument({
    workspaceId: client.workspace_id,
    userId: client.created_by,
    name: `${label} — ${client.name}.pdf`,
    data: pdfs.length === 1 ? pdfs[0] : await mergePdfs(pdfs),
    tags: ["client upload"],
    actorLabel: `${client.name} (portal)`,
  });
  insert("client_files", { id: id("cf_"), workspace_id: client.workspace_id, client_id: client.id, document_id: doc.id, year, category: label, source: "client", shared: 0, created_at: now() });
  notify({ userId: client.assigned_to ?? client.created_by, workspaceId: client.workspace_id, title: `${client.name} uploaded ${label}`, link: `/app/${client.workspace_id}/clients/${client.id}?tab=documents` });
  return json({ ok: true });
});
