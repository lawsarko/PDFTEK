import { z } from "zod";
import { get } from "@/lib/db";
import { body, clientIp, json, notFound, route } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { confirmPayment, paymentCheckout } from "@/lib/esign";
import type { SignatureRequestRow, SignerRow } from "@/lib/signing";

type P = { params: Promise<{ token: string }> };

type PaySigner = SignerRow & { payment_status: string | null; payment_cents: number | null; payment_currency: string | null; payment_desc: string | null; payment_session: string | null };

const Input = z.discriminatedUnion("action", [z.object({ action: z.literal("checkout") }), z.object({ action: z.literal("confirm"), session: z.string().max(200) })]);

/** A signer's payment (signing links that collect a fee): start the checkout, or confirm it on return. */
export const POST = route<P>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`signpay:${clientIp(req)}`, 30, 3600_000);
  const signer = get<PaySigner>("SELECT * FROM signers WHERE token = ?", token);
  if (!signer) throw notFound("This signing link is invalid.");
  const env = get<SignatureRequestRow>("SELECT * FROM signature_requests WHERE id = ?", signer.request_id)!;
  const input = await body(req, Input);
  if (input.action === "checkout") return json({ url: await paymentCheckout(signer, env.workspace_id) });
  return json({ paid: await confirmPayment(signer, env, input.session) });
});
