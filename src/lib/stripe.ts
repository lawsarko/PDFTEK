import "server-only";
import crypto from "node:crypto";
import { HttpError } from "./http";

const API = "https://api.stripe.com/v1";

function flatten(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") out.push(...flatten(v as Record<string, unknown>, key));
    else out.push([key, String(v)]);
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(path: string, params: Record<string, unknown> = {}, method = "POST"): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, "Billing isn't configured on this server.");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : new URLSearchParams(flatten(params)).toString(),
  });
  const data = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new HttpError(502, `Billing error: ${data.error?.message ?? res.status}`);
  return data;
}

/** Verifies a Stripe webhook signature header (v1 scheme, 5 minute tolerance). */
export function verifyStripeSignature(payload: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
