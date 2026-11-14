import { z } from "zod";
import { body, clientIp, json, route, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { SupabaseError, sbUserFromToken, supabaseEnabled } from "@/lib/supabase";
import { signInSupabaseUser, supabaseHttpError } from "@/lib/identity";

/**
 * Finishes a sign-in that started from a Supabase email link (confirm email, magic link). The
 * access token is checked with Supabase before anything else happens.
 */
export const POST = route(async (req) => {
  if (!supabaseEnabled()) throw new HttpError(404, "Not found.");
  rateLimit(`session:${clientIp(req)}`, 30, 15 * 60_000);
  const { accessToken } = await body(req, z.object({ accessToken: z.string().min(10).max(4000) }));
  let sb;
  try {
    sb = await sbUserFromToken(accessToken);
  } catch (e) {
    if (e instanceof SupabaseError && (e.status === 401 || e.status === 403)) throw new HttpError(401, "This link has expired. Sign in, or request a new link.");
    supabaseHttpError(e);
  }
  const { workspaceId } = await signInSupabaseUser(req, sb);
  return json({ ok: true, workspaceId });
});
