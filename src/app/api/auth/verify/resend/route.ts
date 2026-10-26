import { z } from "zod";
import { body, clientIp, json, publicOrigin, route, HttpError } from "@/lib/http";
import { currentUser, rateLimit, sendVerificationEmail } from "@/lib/auth";
import { get } from "@/lib/db";
import { sbResendConfirmation, supabaseEnabled } from "@/lib/supabase";
import { supabaseHttpError } from "@/lib/identity";

/** Sends the confirmation email again: for the signed-in user, or for an email that couldn't sign in yet. */
export const POST = route(async (req) => {
  const user = await currentUser();
  const input = await body(req, z.object({ email: z.string().trim().toLowerCase().email().max(200).optional() }).default({}));
  const signedIn = user && !user.is_guest;
  if (signedIn && user.email_verified) return json({ ok: true, alreadyVerified: true });
  const email = signedIn ? user.email : input.email;
  if (!email) throw new HttpError(400, "Enter your email address.");
  rateLimit(`verify:${clientIp(req)}`, 10, 3600_000);
  rateLimit(`verify:${email}`, 5, 3600_000);
  const origin = publicOrigin(req);

  const local = get<{ id: string; supabase_id: string | null }>("SELECT id, supabase_id FROM users WHERE email = ? AND is_guest = 0", email);
  if (supabaseEnabled() && (!local || local.supabase_id)) {
    await sbResendConfirmation(email, `${origin}/auth/confirm`).catch(supabaseHttpError);
    return json({ ok: true });
  }
  if (!signedIn) return json({ ok: true });
  const sent = await sendVerificationEmail(user.id, user.email, origin);
  if (!sent) throw new HttpError(503, "We couldn't send the email right now. Try again later.");
  return json({ ok: true });
});
