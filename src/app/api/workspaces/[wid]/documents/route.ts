import { all } from "@/lib/db";
import { json, route, badRequest, HttpError } from "@/lib/http";
import { assertBatch, assertFileSize, metered } from "@/lib/billing";
import { requireMember } from "@/lib/auth";
import { createDocument, serializeDoc, type DocumentRow } from "@/lib/documents";

type P = { params: Promise<{ wid: string }> };

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
  assertBatch(ctx, files.length);
  const created = [];
  const errors: { name: string; error: string }[] = [];
  let paywall: HttpError | null = null;
  for (const f of files) {
    try {
      assertFileSize(ctx, f.size, f.name);
      const make = async () =>
        createDocument({ workspaceId: wid, userId: ctx.user.id, name: f.name.slice(0, 200), data: Buffer.from(await f.arrayBuffer()), tags });
      // Opening a PDF is free; turning anything else into a PDF is a conversion task.
      const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
      const doc = isPdf ? await make() : await metered(ctx, req, "Convert to PDF", make);
      created.push(serializeDoc(doc));
    } catch (err) {
      if (err instanceof HttpError && err.status === 402) paywall ??= err;
      errors.push({ name: f.name, error: err instanceof Error ? err.message : "Upload failed." });
    }
  }
  // Nothing went through because of a plan limit: surface it so the app can offer an upgrade.
  if (!created.length && paywall) throw paywall;
  if (!created.length && errors.length) throw badRequest(errors.map((e) => `${e.name}: ${e.error}`).join(" "));
  return json({ documents: created, errors });
});
