import { z } from "zod";
import { get, insert, run } from "@/lib/db";
import { body, clientIp, json, publicOrigin, route, HttpError } from "@/lib/http";
import { createSession, firstWorkspaceFor, rateLimit } from "@/lib/auth";
import { mailConfigured, sendMail } from "@/lib/mail";
import { sha256, token, now } from "@/lib/ids";

/**
 * Recovering a purchase made without an account, e.g. on another device or after clearing cookies.
 * POST emails a one-time sign-in link to the address used at checkout; GET redeems it.
 * The response never reveals whether an email has purchases.
 */
export const POST = route(async (req) => {
  const { email } = await body(req, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  rateLimit(`restore:${clientIp(req)}`, 10, 3600_000);
  rateLimit(`restore:${email}`, 3, 3600_000);
  if (!mailConfigured()) {
    throw new HttpError(503, "Purchase recovery by email isn't available yet. Contact support@pdftek.app with your receipt and we'll restore it.", "mail_disabled");
  }
  const origin = publicOrigin(req);
  const purchase = get<{ workspace_id: string }>("SELECT workspace_id FROM purchases WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1", email);
  const owner = purchase
    ? get<{ id: string; is_guest: number }>(
        "SELECT u.id, u.is_guest FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'owner' LIMIT 1",
        purchase.workspace_id,
      )
    : undefined;
  if (owner?.is_guest) {
    const raw = token(32);
    insert("login_tokens", { id: sha256(raw), user_id: owner.id, expires_at: now() + 30 * 60_000 });
    await sendMail({
      to: email,
      subject: "Restore your pdftek purchase",
      heading: "Restore your purchase",
      paragraphs: [
        "Use the button below to get back to the pdftek workspace where you made your purchase. The link works once and expires in 30 minutes.",
        "Once you're in, create your account (it takes a few seconds) so you can sign in on any device.",
      ],
      cta: { label: "Restore my purchase", url: `${origin}/api/billing/restore?token=${raw}` },
    });
  } else if (owner) {
    await sendMail({
      to: email,
      subject: "Your pdftek purchase",
      heading: "Your purchase is on your account",
      paragraphs: ["This purchase is already saved to a pdftek account. Sign in to use it; if you forgot your password, reply to this email."],
      cta: { label: "Sign in", url: `${origin}/login` },
    });
  }
  return json({ ok: true });
});

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("token") ?? "";
  const row = raw ? get<{ id: string; user_id: string; expires_at: number; used_at: number | null }>("SELECT * FROM login_tokens WHERE id = ?", sha256(raw)) : undefined;
  if (!row || row.used_at || row.expires_at < now()) {
    return new Response(null, { status: 303, headers: { Location: "/restore?expired=1" } });
  }
  run("UPDATE login_tokens SET used_at = ? WHERE id = ?", now(), row.id);
  await createSession(row.user_id, req.headers.get("user-agent"));
  const wid = firstWorkspaceFor(row.user_id);
  return new Response(null, { status: 303, headers: { Location: wid ? `/app/${wid}?save=1` : "/app", "Cache-Control": "no-store" } });
}
