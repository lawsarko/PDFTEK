import { z } from "zod";
import { all, get, run } from "@/lib/db";
import { body, json, route, badRequest, forbidden } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const members = all<{ id: string; name: string; email: string; role: string; created_at: number }>(
    `SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ? ORDER BY m.created_at`,
    wid,
  );
  const invites =
    ctx.role === "member"
      ? []
      : all<{ id: string; email: string; role: string; token: string; created_at: number }>(
          "SELECT id, email, role, token, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
          wid,
        );
  return json({ members, invites });
});

const Patch = z.object({ userId: z.string(), role: z.enum(["owner", "admin", "member"]) });

export const PATCH = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid, "admin");
  const input = await body(req, Patch);
  if (input.role === "owner" && ctx.role !== "owner") throw forbidden("Only owners can promote to owner.");
  const target = get<{ role: string }>("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?", wid, input.userId);
  if (!target) throw badRequest("Not a member.");
  if (target.role === "owner" && ctx.role !== "owner") throw forbidden("Only owners can change another owner.");
  if (target.role === "owner" && input.role !== "owner") {
    const owners = get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner'", wid)!.n;
    if (owners <= 1) throw badRequest("A workspace needs at least one owner.");
  }
  run("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?", input.role, wid, input.userId);
  return json({ ok: true });
});

export const DELETE = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") ?? "";
  const ctx = await requireMember(wid);
  const self = userId === ctx.user.id;
  if (!self && ctx.role === "member") throw forbidden();
  const target = get<{ role: string }>("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?", wid, userId);
  if (!target) throw badRequest("Not a member.");
  if (target.role === "owner") {
    const owners = get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner'", wid)!.n;
    if (owners <= 1) throw badRequest("Transfer ownership before the last owner leaves.");
    if (!self && ctx.role !== "owner") throw forbidden();
  }
  run("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?", wid, userId);
  run("UPDATE documents SET checked_out_by = NULL, checked_out_at = NULL WHERE workspace_id = ? AND checked_out_by = ?", wid, userId);
  logActivity({ workspaceId: wid, userId: ctx.user.id, action: self ? "left" : "removed_member" });
  return json({ ok: true });
});
