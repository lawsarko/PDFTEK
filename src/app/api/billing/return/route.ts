import { stripe } from "@/lib/stripe";
import { fulfill, type ProductId } from "@/lib/billing";
import { get } from "@/lib/db";
import { sha256 } from "@/lib/ids";

type Session = {
  id: string;
  status: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  customer: string | null;
  subscription: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: { workspace_id?: string; product?: ProductId };
};

/**
 * Stripe sends buyers here after paying. Fulfilment also happens in the webhook; doing it here too
 * means the purchase is live the moment the buyer lands back, even if the webhook is late.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? "/app";
  const back = to.startsWith("/") && !to.startsWith("//") ? to : "/app";
  const sid = url.searchParams.get("session_id");
  let product = "";
  // For conversion measurement on the page they land on: an order reference (not the Stripe id),
  // the amount actually charged, and whether this is the customer's first purchase.
  let extra = "";
  if (sid) {
    try {
      const s = await stripe<Session>(`/checkout/sessions/${encodeURIComponent(sid)}`, {}, "GET");
      const wid = s.metadata?.workspace_id;
      if (wid && s.metadata?.product && (s.payment_status === "paid" || s.payment_status === "no_payment_required")) {
        const email = s.customer_details?.email ?? null;
        const before = get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM purchases WHERE stripe_session_id != ? AND (workspace_id = ? OR (email IS NOT NULL AND email = ?))",
          s.id,
          wid,
          email,
        )!.n;
        extra = `&order=${sha256(s.id).slice(0, 16)}&paid=${s.amount_total ?? 0}&new=${before ? 0 : 1}`;
        fulfill({
          workspaceId: wid,
          product: s.metadata.product,
          sessionId: s.id,
          amountCents: s.amount_total ?? 0,
          currency: s.currency ?? "usd",
          email: s.customer_details?.email ?? null,
          customerId: s.customer,
          subscriptionId: s.subscription,
        });
        product = s.metadata.product;
      }
    } catch (err) {
      console.error("[pdftek] checkout return failed", err);
    }
  }
  const dest = product ? `${back}${back.includes("?") ? "&" : "?"}purchased=${product}${extra}` : back;
  return new Response(null, { status: 303, headers: { Location: dest, "Cache-Control": "no-store" } });
}
