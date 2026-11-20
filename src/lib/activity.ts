import "server-only";
import { all, insert } from "./db";
import { id, now } from "./ids";

export function logActivity(opts: {
  workspaceId: string;
  userId?: string | null;
  actorLabel?: string;
  action: string;
  documentId?: string | null;
  meta?: Record<string, unknown>;
}) {
  insert("activity", {
    id: id("act_"),
    workspace_id: opts.workspaceId,
    user_id: opts.userId ?? null,
    actor_label: opts.actorLabel ?? null,
    action: opts.action,
    document_id: opts.documentId ?? null,
    meta_json: JSON.stringify(opts.meta ?? {}),
    created_at: now(),
  });
}

export function notify(opts: { userId: string; workspaceId: string; title: string; body?: string; link?: string }) {
  insert("notifications", {
    id: id("ntf_"),
    user_id: opts.userId,
    workspace_id: opts.workspaceId,
    title: opts.title,
    body: opts.body ?? "",
    link: opts.link ?? null,
    created_at: now(),
  });
}

export function notifyWorkspace(workspaceId: string, opts: { title: string; body?: string; link?: string; exceptUserId?: string }) {
  const members = all<{ user_id: string }>("SELECT user_id FROM memberships WHERE workspace_id = ?", workspaceId);
  for (const m of members) {
    if (m.user_id === opts.exceptUserId) continue;
    notify({ userId: m.user_id, workspaceId, title: opts.title, body: opts.body, link: opts.link });
  }
}
