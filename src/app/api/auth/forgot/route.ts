import { z } from "zod";
import { get } from "@/lib/db";
import { body, clientIp, json, publicOrigin, route, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { mailConfigured, sendMail } from "@/lib/mail";
import { issueToken } from "@/lib/tokens";

/** Emails a password-reset link. Always answers the same way, so it can't be used to find accounts. */
export const POST = route(async (req) => {
  const { email } = await body(req, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  rateLimit(`forgot:${clientIp(req)}`, 10, 3600_000);
  rateLimit(`forgot:${email}`, 3, 3600_000);
  if (!mailConfigured()) {
    throw new HttpError(503, "Password reset by email isn't available yet. Contact support@pdftek.app and we'll help you get back in.", "mail_disabled");
  }
  const user = get<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = ? AND is_guest = 0", email);
  if (user) {
    const raw = issueToken(user.id, "reset", 60 * 60_000);
    await sendMail({
      to: email,
      subject: "Reset your pdftek password",
      heading: "Reset your password",
      paragraphs: [
        `Hi ${user.name.split(" ")[0]}, someone (hopefully you) asked to reset your pdftek password. The link works once and expires in 1 hour.`,
        "If you didn't ask for this, ignore this email. Your password won't change.",
      ],
      cta: { label: "Choose a new password", url: `${publicOrigin(req)}/reset?token=${raw}` },
    });
  }
  return json({ ok: true });
});
