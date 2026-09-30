import { all } from "@/lib/db";
import { json, route, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { createDocument, serializeDoc, type DocumentRow } from "@/lib/documents";

type P = { params: Promise<{ wid: string }> };

const MAX_UPLOAD = 60 * 1024 * 1024;

export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const url = new URL(req.url);
  const trash = url.searchParams.get("trash") === "1";
  const rows = all<DocumentRow>(
    `SELECT * FROM documents WHERE workspace_id = ? AND deleted_at IS ${trash ? "NOT NULL" : "NULL"} ORDER BY updated_at DESC LIMIT 500`,
    wid,
  );
  return json({ documents: rows.map(serializeDoc) });
});

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const tags = String(form.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
  if (!files.length) throw badRequest("Choose at least one file.");
  if (files.length > 20) throw badRequest("Upload at most 20 files at a time.");
  const created = [];
  const errors: { name: string; error: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_UPLOAD) {
      errors.push({ name: f.name, error: "File is larger than 60 MB." });
      continue;
    }
    try {
      const doc = await createDocument({ workspaceId: wid, userId: ctx.user.id, name: f.name.slice(0, 200), data: Buffer.from(await f.arrayBuffer()), tags });
      created.push(serializeDoc(doc));
    } catch (err) {
      errors.push({ name: f.name, error: err instanceof Error ? err.message : "Upload failed." });
    }
  }
  if (!created.length && errors.length) throw badRequest(errors.map((e) => `${e.name}: ${e.error}`).join(" "));
  return json({ documents: created, errors });
});
