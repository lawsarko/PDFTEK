import { cookies } from "next/headers";
import { get, insert, run } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { publicOrigin } from "@/lib/http";
import { createSession, createWorkspace, currentUser, destroyAllSessions, firstWorkspaceFor, mergeGuestInto } from "@/lib/auth";
import { GOOGLE_COOKIE, exchangeGoogleCode } from "@/lib/google-auth";
import { logActivity } from "@/lib/activity";

const go = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

/**
 * Google sends people back here. Finds the account by Google id, then by verified email (linking
 * Google to an existing password account), or creates one. A guest who signs in keeps their files
 * and purchases, exactly like with a password.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = jar.get(GOOGLE_COOKIE)?.value;
  jar.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
  let stash: { state: string; verifier: string; next: string } | null = null;
  try {
    stash = saved ? JSON.parse(saved) : null;
  } catch {}
  const code = url.searchParams.get("code");
  if (!stash || !code || url.searchParams.get("state") !== stash.state) return go("/login?error=google");

  let profile;
  try {
    profile = await exchangeGoogleCode(publicOrigin(req), code, stash.verifier);
  } catch (err) {
    console.error("[pdftek] Google sign-in failed", err);
    return go("/login?error=google");
  }

  const current = await currentUser();
  const existing =
    get<{ id: string; email_verified_at: number | null }>("SELECT id, email_verified_at FROM users WHERE google_sub = ?", profile.sub) ??
    get<{ id: string; email_verified_at: number | null }>("SELECT id, email_verified_at FROM users WHERE email = ? AND is_guest = 0", profile.email);

  let userId: string;
  if (existing) {
    userId = existing.id;
    if (!existing.email_verified_at) {
      // Nobody ever proved they own this address, so someone else may have signed up with it first.
      // The Google owner takes it over: that password and any open sessions stop working.
      run("UPDATE users SET password_hash = '!' WHERE id = ?", userId);
      destroyAllSessions(userId);
    }
    // Google has verified this email, so linking it to the account (and marking it verified) is safe.
    run("UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", profile.sub, now(), userId);
    const wid = firstWorkspaceFor(userId);
    if (current?.is_guest && wid) mergeGuestInto(current.id, wid, userId);
  } else if (current?.is_guest) {
    // The guest becomes a real account: files and purchases stay put.
    userId = current.id;
    run(
      "UPDATE users SET email = ?, name = ?, google_sub = ?, is_guest = 0, password_hash = '!', email_verified_at = ? WHERE id = ?",
      profile.email,
      profile.name,
      profile.sub,
      now(),
      userId,
    );
    const wid = firstWorkspaceFor(userId);
    if (wid) run("UPDATE workspaces SET name = ? WHERE id = ?", `${profile.name.split(" ")[0]}'s workspace`, wid);
  } else {
    userId = id("usr_");
    insert("users", {
      id: userId,
      email: profile.email,
      name: profile.name,
      password_hash: "!", // Google-only until they set a password via "Forgot password"
      google_sub: profile.sub,
      email_verified_at: now(),
      created_at: now(),
    });
    const wid = createWorkspace(`${profile.name.split(" ")[0]}'s workspace`, userId);
    logActivity({ workspaceId: wid, userId, action: "created_workspace" });
  }

  await createSession(userId, req.headers.get("user-agent"));
  const wid = firstWorkspaceFor(userId);
  return go(stash.next || (wid ? `/app/${wid}` : "/app"));
}
