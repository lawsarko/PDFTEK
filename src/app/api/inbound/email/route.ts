import crypto from "node:crypto";
import { HttpError, json, route } from "@/lib/http";
import { inboundDomain, parseForm, parseJson, parseRaw, receive } from "@/lib/email-in";

/**
 * Webhook for inbound email (Email in). Point your inbound-email service here:
 *   POST https://pdftek.com/api/inbound/email?key=INBOUND_EMAIL_SECRET
 * Accepts Postmark-style JSON, multipart posts (SendGrid Inbound Parse, Mailgun Routes) and raw
 * RFC 822 messages (Cloudflare Email Workers: content-type message/rfc822).
 */
export const POST = route(async (req) => {
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (!secret || !inboundDomain()) throw new HttpError(503, "Email in isn't set up on this server.");
  const given = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-pdftek-key") ?? "";
  const ok = given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) throw new HttpError(401, "Unauthorized.");

  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const message = type.includes("application/json")
    ? parseJson((await req.json()) as Record<string, unknown>)
    : type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")
      ? await parseForm(await req.formData())
      : await parseRaw(new Uint8Array(await req.arrayBuffer()), (req.headers.get("x-envelope-to") ?? "").split(",").filter(Boolean));
  const result = await receive(message);
  // Always 200 for messages we understood, so the service doesn't retry a rejected sender forever.
  return json({ ok: true, ...result });
});
