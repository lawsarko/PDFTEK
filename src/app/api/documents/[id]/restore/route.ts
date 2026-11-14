import { get, run } from "@/lib/db";
import { json, route, notFound } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

/** Restores a document from the trash. */
export const POST = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const row = get<{ workspace_id: string }>("SELECT workspace_id FROM documents WHERE id = ? AND deleted_at IS NOT NULL", id);
  if (!row) throw notFound();
  const ctx = await requireMember(row.workspace_id);
  run("UPDATE documents SET deleted_at = NULL WHERE id = ?", id);
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "restored", documentId: id });
  return json({ ok: true });
});
