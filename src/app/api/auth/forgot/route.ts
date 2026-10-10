import { z } from "zod";
import { get, run } from "@/lib/db";
import { body, clientIp, json, publicOrigin, route, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { mailConfigured, sendMail } from "@/lib/mail";
import { issueToken } from "@/lib/tokens";
import { sbAdminCreateUser, sbRecover, supabaseAdminEnabled, supabaseEnabled } from "@/lib/supabase";
import { supabaseHttpError } from "@/lib/identity";

/** Emails a password-reset link. Always answers the same way, so it can't be used to find accounts. */
export const POST = route(async (req) => {
  const { email } = await body(req, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  rateLimit(`forgot:${clientIp(req)}`, 10, 3600_000);
  rateLimit(`forgot:${email}`, 3, 3600_000);
  if (supabaseEnabled()) {
    const local = get<{ id: string; name: string; supabase_id: string | null; email_verified_at: number | null }>(
      "SELECT id, name, supabase_id, email_verified_at FROM users WHERE email = ? AND is_guest = 0",
      email,
    );
    // An account from before Supabase gets a Supabase login first, so the reset email can reach it.
    let linked = Boolean(local?.supabase_id);
    if (local && !linked && supabaseAdminEnabled()) {
      try {
        const sb = await sbAdminCreateUser(email, null, local.name, Boolean(local.email_verified_at));
        run("UPDATE users SET supabase_id = ? WHERE id = ?", sb.id, local.id);
        linked = true;
      } catch (e) {
        console.error("[pdftek] couldn't move account to Supabase", e instanceof Error ? e.message : e);
      }
    }
    // Accounts not yet in Supabase fall back to pdftek's own email below, when it's set up.
    if (!local || linked || !mailConfigured()) {
      // Supabase answers the same way whether or not the account exists.
      await sbRecover(email, `${publicOrigin(req)}/auth/confirm`).catch(supabaseHttpError);
      return json({ ok: true });
    }
  }
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
