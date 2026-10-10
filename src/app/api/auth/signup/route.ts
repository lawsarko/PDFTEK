import { z } from "zod";
import { get, insert, run } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { body, clientIp, conflict, json, publicOrigin, route, badRequest, HttpError } from "@/lib/http";
import { createSession, createWorkspace, currentUser, firstWorkspaceFor, hashPassword, rateLimit, sendVerificationEmail } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sbAdminCreateUser, sbSignUp, supabaseAdminEnabled, supabaseEnabled } from "@/lib/supabase";
import { SUPABASE_PASSWORD, supabaseHttpError } from "@/lib/identity";

const Input = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "must be at least 8 characters").max(200),
  workspaceName: z.string().trim().max(80).optional(),
  inviteToken: z.string().max(100).optional(),
});

export const POST = route(async (req) => {
  rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000);
  const input = await body(req, Input);
  if (get("SELECT 1 FROM users WHERE email = ?", input.email)) throw conflict("An account with that email already exists. Sign in instead.");

  const invite = input.inviteToken
    ? get<{ id: string; workspace_id: string; email: string; role: string; accepted_at: number | null }>("SELECT * FROM invites WHERE token = ?", input.inviteToken)
    : undefined;
  if (input.inviteToken && (!invite || invite.accepted_at)) throw badRequest("That invitation is no longer valid.");

  // An accepted invite already proves the email works.
  const inviteMatches = Boolean(invite && invite.email.toLowerCase() === input.email);
  const origin = publicOrigin(req);

  // With Supabase, the password lives there and Supabase sends the confirmation email.
  let identity = { passwordHash: hashPassword(input.password), supabaseId: null as string | null, verified: inviteMatches, ownEmail: !inviteMatches };
  if (supabaseEnabled()) {
    try {
      if (inviteMatches && supabaseAdminEnabled()) {
        const sb = await sbAdminCreateUser(input.email, input.password, input.name, true);
        identity = { passwordHash: SUPABASE_PASSWORD, supabaseId: sb.id, verified: true, ownEmail: false };
      } else {
        const r = await sbSignUp(input.email, input.password, input.name, `${origin}/auth/confirm`);
        if (r.exists) throw conflict("An account with that email already exists. Sign in instead.");
        identity = { passwordHash: SUPABASE_PASSWORD, supabaseId: r.user.id, verified: r.confirmed, ownEmail: false };
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      supabaseHttpError(e);
    }
  }
  const finish = async (userId: string) => {
    run("UPDATE users SET supabase_id = ?, email_verified_at = ? WHERE id = ?", identity.supabaseId, identity.verified ? now() : null, userId);
    if (identity.ownEmail) await sendVerificationEmail(userId, input.email, origin);
  };

  // A guest who signs up keeps everything: the guest user simply becomes a real account.
  const guest = await currentUser();
  if (guest?.is_guest && !invite) {
    run("UPDATE users SET email = ?, name = ?, password_hash = ?, is_guest = 0 WHERE id = ?", input.email, input.name, identity.passwordHash, guest.id);
    const wsId = firstWorkspaceFor(guest.id)!;
    run("UPDATE workspaces SET name = ? WHERE id = ?", input.workspaceName || `${input.name.split(" ")[0]}'s workspace`, wsId);
    logActivity({ workspaceId: wsId, userId: guest.id, action: "created_workspace" });
    await finish(guest.id);
    return json({ ok: true, workspaceId: wsId, confirmEmail: !identity.verified });
  }

  const userId = id("usr_");
  insert("users", { id: userId, email: input.email, name: input.name, password_hash: identity.passwordHash, created_at: now() });

  let workspaceId: string;
  if (invite) {
    insert("memberships", { workspace_id: invite.workspace_id, user_id: userId, role: invite.role, created_at: now() });
    run("UPDATE invites SET accepted_at = ? WHERE id = ?", now(), invite.id);
    workspaceId = invite.workspace_id;
    logActivity({ workspaceId, userId, action: "joined" });
  } else {
    workspaceId = createWorkspace(input.workspaceName || `${input.name.split(" ")[0]}'s workspace`, userId);
    logActivity({ workspaceId, userId, action: "created_workspace" });
  }
  await createSession(userId, req.headers.get("user-agent"));
  await finish(userId);
  return json({ ok: true, workspaceId, confirmEmail: !identity.verified });
});
