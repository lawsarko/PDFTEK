import { z } from "zod";
import { get, run } from "@/lib/db";
import { body, clientIp, json, route, HttpError } from "@/lib/http";
import { createSession, currentUser, firstWorkspaceFor, mergeGuestInto, rateLimit, verifyPassword } from "@/lib/auth";
import { SupabaseError, sbAdminCreateUser, sbPasswordLogin, supabaseAdminEnabled, supabaseEnabled } from "@/lib/supabase";
import { SUPABASE_PASSWORD, signInSupabaseUser, supabaseHttpError } from "@/lib/identity";

const Input = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const input = await body(req, Input);
  rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000);
  rateLimit(`login:${input.email}`, 10, 15 * 60_000);

  if (supabaseEnabled()) {
    try {
      const s = await sbPasswordLogin(input.email, input.password);
      const { workspaceId } = await signInSupabaseUser(req, s.user);
      return json({ ok: true, workspaceId });
    } catch (e) {
      if (e instanceof SupabaseError && e.code === "email_not_confirmed") {
        throw new HttpError(403, "Please confirm your email first. Check your inbox for the link we sent.", "email_not_confirmed");
      }
      // Wrong password, or an account from before Supabase: checked against the local password below.
      if (!(e instanceof SupabaseError && e.status === 400)) supabaseHttpError(e);
    }
  }

  const user = get<{ id: string; name: string; password_hash: string; email_verified_at: number | null; supabase_id: string | null }>(
    "SELECT id, name, password_hash, email_verified_at, supabase_id FROM users WHERE email = ? AND is_guest = 0",
    input.email,
  );
  if (user?.password_hash === "!") {
    throw new HttpError(401, "This account uses Google sign-in. Choose Continue with Google, or use Forgot password to add a password.");
  }
  if (!user || user.password_hash === SUPABASE_PASSWORD || !verifyPassword(input.password, user.password_hash)) {
    throw new HttpError(401, "Email or password is incorrect.");
  }
  // Moves the account into Supabase with the same password, so later sign-ins go through Supabase.
  if (supabaseAdminEnabled() && !user.supabase_id) {
    try {
      const sb = await sbAdminCreateUser(input.email, input.password, user.name, Boolean(user.email_verified_at));
      run("UPDATE users SET supabase_id = ?, password_hash = ? WHERE id = ?", sb.id, SUPABASE_PASSWORD, user.id);
    } catch (e) {
      console.error("[pdftek] couldn't move account to Supabase", e instanceof Error ? e.message : e);
    }
  }
  const guest = await currentUser();
  const workspaceId = firstWorkspaceFor(user.id) ?? null;
  // Work done (or bought) as a guest before signing in moves into the account.
  if (guest?.is_guest && workspaceId) mergeGuestInto(guest.id, workspaceId, user.id);
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ ok: true, workspaceId });
});
