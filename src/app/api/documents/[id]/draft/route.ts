import { run } from "@/lib/db";
import { json, route, badRequest } from "@/lib/http";
import { docAccess, assertCanEdit } from "@/lib/documents";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  return json({ draft: doc.draft_json ? JSON.parse(doc.draft_json) : null });
});

/** Autosaves in-progress editor operations so work survives reloads and hand-offs. */
export const PUT = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  assertCanEdit(doc, ctx.user.id);
  const text = await req.text();
  if (text.length > 8_000_000) throw badRequest("Draft is too large; save a version first.");
  const parsed = JSON.parse(text || "null");
  run("UPDATE documents SET draft_json = ? WHERE id = ?", parsed ? JSON.stringify({ ...parsed, savedAt: Date.now(), by: ctx.user.id }) : null, id);
  return json({ ok: true, savedAt: Date.now() });
});
