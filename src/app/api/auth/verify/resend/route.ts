import { json, publicOrigin, route, HttpError } from "@/lib/http";
import { rateLimit, requireUser, sendVerificationEmail } from "@/lib/auth";

export const POST = route(async (req) => {
  const user = await requireUser();
  if (user.is_guest || user.email_verified) return json({ ok: true, alreadyVerified: user.email_verified });
  rateLimit(`verify:${user.id}`, 5, 3600_000);
  const sent = await sendVerificationEmail(user.id, user.email, publicOrigin(req));
  if (!sent) throw new HttpError(503, "We couldn't send the email right now. Try again later.");
  return json({ ok: true });
});
