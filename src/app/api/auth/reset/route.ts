import { z } from "zod";
import { run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route, badRequest } from "@/lib/http";
import { createSession, destroyAllSessions, firstWorkspaceFor, hashPassword } from "@/lib/auth";
import { consumeToken } from "@/lib/tokens";
import { SupabaseError, sbUpdatePassword, supabaseEnabled } from "@/lib/supabase";
import { signInSupabaseUser, supabaseHttpError } from "@/lib/identity";

const Input = z.object({
  // pdftek's own reset link…
  token: z.string().min(10).max(200).optional(),
  // …or the session from Supabase's reset link (see /auth/confirm).
  accessToken: z.string().min(10).max(4000).optional(),
  password: z.string().min(8, "must be at least 8 characters").max(200),
});

/** Sets a new password from a reset link, signs out every other device, and signs this one in. */
export const POST = route(async (req) => {
  const input = await body(req, Input);
  if (input.accessToken && supabaseEnabled()) {
    let user;
    try {
      user = await sbUpdatePassword(input.accessToken, input.password);
    } catch (e) {
      if (e instanceof SupabaseError && e.status === 401) throw badRequest("This reset link has expired. Request a new one.");
      supabaseHttpError(e);
    }
    const { workspaceId } = await signInSupabaseUser(req, user, { signOutOthers: true });
    return json({ ok: true, workspaceId });
  }
  const userId = input.token ? consumeToken(input.token, "reset") : null;
  if (!userId) throw badRequest("This reset link has expired or was already used. Request a new one.");
  // Clicking the emailed link also proves the address is theirs.
  run("UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", hashPassword(input.password), now(), userId);
  destroyAllSessions(userId);
  await createSession(userId, req.headers.get("user-agent"));
  return json({ ok: true, workspaceId: firstWorkspaceFor(userId) ?? null });
});
