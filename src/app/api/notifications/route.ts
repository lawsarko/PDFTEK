import { z } from "zod";
import { all, get, run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const GET = route(async () => {
  const user = await requireUser();
  const items = all("SELECT id, workspace_id AS workspaceId, title, body, link, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40", user.id);
  const unread = get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id)!.n;
  return json({ items, unread });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await body(req, z.object({ ids: z.array(z.string()).optional() }));
  if (input.ids?.length) {
    for (const nid of input.ids) run("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?", now(), nid, user.id);
  } else {
    run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), user.id);
  }
  return json({ ok: true });
});
