import { z } from "zod";
import { all, get, run } from "@/lib/db";
import { body, json, route, badRequest } from "@/lib/http";
import { effectivePlan, hashPassword, requireUser, verifyPassword, type Plan } from "@/lib/auth";
import { SupabaseError, sbPasswordLogin, sbUpdatePassword, supabaseEnabled } from "@/lib/supabase";
import { SUPABASE_PASSWORD, supabaseHttpError } from "@/lib/identity";

export const GET = route(async () => {
  const user = await requireUser();
  const workspaces = all<{ id: string; name: string; role: string; plan: Plan; trial_ends_at: number | null }>(
    `SELECT w.id, w.name, m.role, w.plan, w.trial_ends_at FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? ORDER BY m.created_at`,
    user.id,
  ).map((w) => ({ id: w.id, name: w.name, role: w.role, plan: effectivePlan(w) }));
  return json({ user, workspaces });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const input = await body(req, Patch);
  if (input.name) run("UPDATE users SET name = ? WHERE id = ?", input.name, user.id);
  if (input.newPassword) {
    const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)!;
    if (!input.currentPassword) throw badRequest("Current password is incorrect.");
    if (row.password_hash === SUPABASE_PASSWORD && supabaseEnabled()) {
      // The password lives in Supabase: prove the current one there, then change it there.
      try {
        const s = await sbPasswordLogin(user.email, input.currentPassword);
        await sbUpdatePassword(s.access_token, input.newPassword);
      } catch (e) {
        if (e instanceof SupabaseError && e.status === 400 && /credentials|grant/i.test(e.code + e.message)) throw badRequest("Current password is incorrect.");
        supabaseHttpError(e);
      }
    } else {
      if (!verifyPassword(input.currentPassword, row.password_hash)) throw badRequest("Current password is incorrect.");
      run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(input.newPassword), user.id);
    }
  }
  return json({ ok: true });
});
