import "server-only";
import { all, get, insert, run } from "./db";
import { id, now } from "./ids";
import { HttpError } from "./http";
import { createSession, createWorkspace, currentUser, destroyAllSessions, firstWorkspaceFor, mergeGuestInto } from "./auth";
import { logActivity } from "./activity";
import { SupabaseError, displayName, type SbUser } from "./supabase";

/** Marks local users whose password lives in Supabase (never matches a local password check). */
export const SUPABASE_PASSWORD = "supabase";

/**
 * Signs a Supabase-authenticated person in to pdftek: finds or creates the local user, carries over
 * whatever they did as a guest, and starts a pdftek session.
 */
export async function signInSupabaseUser(req: Request, sb: SbUser, opts: { signOutOthers?: boolean } = {}) {
  const email = sb.email?.trim().toLowerCase();
  if (!email) throw new HttpError(400, "Your sign-in didn't include an email address.");
  const confirmed = Boolean(sb.email_confirmed_at);
  const name = displayName(sb);
  const current = await currentUser();
  const guest = current?.is_guest ? current : null;

  let userId: string;
  const linked = get<{ id: string }>("SELECT id FROM users WHERE supabase_id = ?", sb.id);
  const byEmail = linked ? undefined : get<{ id: string; email_verified_at: number | null }>("SELECT id, email_verified_at FROM users WHERE email = ? AND is_guest = 0", email);

  if (linked) {
    userId = linked.id;
    // The email may have changed in Supabase.
    if (!get("SELECT 1 FROM users WHERE email = ? AND id != ?", email, userId)) run("UPDATE users SET email = ? WHERE id = ?", email, userId);
  } else if (byEmail) {
    // An account from before Supabase. Only link it once Supabase has confirmed the address.
    if (!confirmed) throw new HttpError(409, "An account with this email already exists. Sign in with your password instead.");
    userId = byEmail.id;
    run("UPDATE users SET supabase_id = ? WHERE id = ?", sb.id, userId);
    if (!byEmail.email_verified_at) {
      // Nobody had proved they own this address, so someone else may have signed up with it first:
      // their password and sessions stop working. (A verified account keeps its password.)
      run("UPDATE users SET password_hash = ? WHERE id = ?", SUPABASE_PASSWORD, userId);
      destroyAllSessions(userId);
    }
  } else if (guest) {
    // The guest becomes a real account: files and purchases stay put.
    userId = guest.id;
    run("UPDATE users SET email = ?, name = ?, supabase_id = ?, password_hash = ?, is_guest = 0 WHERE id = ?", email, name, sb.id, SUPABASE_PASSWORD, userId);
    const wid = firstWorkspaceFor(userId);
    if (wid) {
      run("UPDATE workspaces SET name = ? WHERE id = ?", `${name.split(" ")[0]}'s workspace`, wid);
      logActivity({ workspaceId: wid, userId, action: "created_workspace" });
    }
  } else {
    userId = id("usr_");
    insert("users", { id: userId, email, name, password_hash: SUPABASE_PASSWORD, supabase_id: sb.id, created_at: now() });
    const wid = createWorkspace(`${name.split(" ")[0]}'s workspace`, userId);
    logActivity({ workspaceId: wid, userId, action: "created_workspace" });
  }

  if (confirmed) run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", now(), userId);
  const workspaceId = firstWorkspaceFor(userId) ?? createWorkspace(`${name.split(" ")[0]}'s workspace`, userId);

  if (guest && guest.id !== userId) mergeGuestInto(guest.id, workspaceId, userId);
  // Purchases made without an account with this (now proven) email come along, from any device.
  if (confirmed) {
    for (const g of all<{ user_id: string }>(
      `SELECT DISTINCT m.user_id FROM purchases p JOIN memberships m ON m.workspace_id = p.workspace_id AND m.role = 'owner'
         JOIN users u ON u.id = m.user_id WHERE lower(p.email) = ? AND u.is_guest = 1 AND u.id != ?`,
      email,
      userId,
    )) {
      mergeGuestInto(g.user_id, workspaceId, userId);
    }
  }

  if (opts.signOutOthers) destroyAllSessions(userId);
  await createSession(userId, req.headers.get("user-agent"));
  return { userId, workspaceId };
}

/** Turns a Supabase failure into a message for the person signing in. */
export function supabaseHttpError(e: unknown): never {
  if (e instanceof SupabaseError) {
    if (e.status === 429 || /rate_limit/.test(e.code)) throw new HttpError(429, "Too many attempts or emails. Wait a minute and try again.");
    if (e.status === 422 && /weak_password/.test(e.code)) throw new HttpError(400, e.message);
    if (e.status >= 400 && e.status < 500) throw new HttpError(400, e.message);
    console.error("[pdftek] Supabase auth error", e.status, e.code, e.message);
    throw new HttpError(502, "Sign-in is temporarily unavailable. Try again in a moment.");
  }
  throw e;
}
