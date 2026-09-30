import { get, insert, run } from "@/lib/db";
import { now } from "@/lib/ids";
import { json, route, badRequest } from "@/lib/http";
import { requireUser, membership } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ token: string }> };

export const POST = route<P>(async (_req, { params }) => {
  const { token } = await params;
  const user = await requireUser();
  const invite = get<{ id: string; workspace_id: string; role: string; accepted_at: number | null }>("SELECT * FROM invites WHERE token = ?", token);
  if (!invite || invite.accepted_at) throw badRequest("That invitation is no longer valid.");
  if (!membership(invite.workspace_id, user.id)) {
    insert("memberships", { workspace_id: invite.workspace_id, user_id: user.id, role: invite.role, created_at: now() });
    logActivity({ workspaceId: invite.workspace_id, userId: user.id, action: "joined" });
  }
  run("UPDATE invites SET accepted_at = ? WHERE id = ?", now(), invite.id);
  return json({ workspaceId: invite.workspace_id });
});
