import { z } from "zod";
import { run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route } from "@/lib/http";
import { docAccess, serializeDoc, listVersions, getDocument, assertCanEdit } from "@/lib/documents";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  return json({ document: serializeDoc(doc), versions: listVersions(doc.id) });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const input = await body(req, Patch);
  if (input.name !== undefined) {
    assertCanEdit(doc, ctx.user.id);
    run("UPDATE documents SET name = ?, updated_at = ? WHERE id = ?", input.name, now(), id);
    logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "renamed", documentId: id, meta: { from: doc.name, to: input.name } });
  }
  if (input.tags !== undefined) run("UPDATE documents SET tags = ? WHERE id = ?", JSON.stringify([...new Set(input.tags)]), id);
  return json({ document: serializeDoc(getDocument(ctx, id)) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  assertCanEdit(doc, ctx.user.id);
  run("UPDATE documents SET deleted_at = ?, checked_out_by = NULL WHERE id = ?", now(), id);
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "deleted", documentId: id, meta: { name: doc.name } });
  return json({ ok: true });
});
