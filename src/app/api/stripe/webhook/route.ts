import { run } from "@/lib/db";
import { json } from "@/lib/http";
import { verifyStripeSignature } from "@/lib/stripe";
import { PRODUCTS, fulfill, type ProductId } from "@/lib/billing";

type StripeObject = Record<string, unknown> & { metadata?: Record<string, string> };
type StripeEvent = { type: string; data: { object: StripeObject } };

/**
 * Stripe → pdftek. Point a webhook at /api/stripe/webhook with these events:
 * checkout.session.completed, invoice.paid, customer.subscription.updated,
 * customer.subscription.deleted.
 */
export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"))) return json({ error: "bad signature" }, 400);
  const event = JSON.parse(payload) as StripeEvent;
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const wid = obj.metadata?.workspace_id ?? (obj.client_reference_id as string | undefined);
      const product = (obj.metadata?.product ?? legacyProduct(obj.metadata?.plan)) as ProductId | undefined;
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
      if (wid && product && PRODUCTS[product] && paid) {
        fulfill({
          workspaceId: wid,
          product,
          sessionId: obj.id as string,
          amountCents: (obj.amount_total as number | null) ?? 0,
          currency: (obj.currency as string | null) ?? "usd",
          email: (obj.customer_details as { email?: string } | null)?.email ?? null,
          customerId: (obj.customer as string | null) ?? null,
          subscriptionId: (obj.subscription as string | null) ?? null,
        });
      }
      break;
    }
    case "invoice.paid": {
      // A renewal: the next monthly AI allowance is granted on the next request (see refillAllowance).
      // Newer Stripe API versions (2025-03-31+) moved the subscription under invoice.parent.
      const parent = obj.parent as { subscription_details?: { subscription?: string } } | undefined;
      const sub = (obj.subscription as string | undefined) ?? parent?.subscription_details?.subscription;
      if (sub && obj.billing_reason === "subscription_cycle") {
        run("UPDATE workspaces SET allowance_expires_at = NULL WHERE stripe_subscription_id = ?", sub);
      }
      break;
    }
    // Matched by subscription id as well as metadata: a guest's subscription may have moved to the
    // account they later signed in to.
    case "customer.subscription.updated": {
      const active = ["active", "trialing", "past_due"].includes(obj.status as string);
      const plan = obj.metadata?.plan === "business" ? "business" : "pro";
      run("UPDATE workspaces SET plan = ? WHERE stripe_subscription_id = ? OR id = ?", active ? plan : "free", obj.id as string, obj.metadata?.workspace_id ?? "");
      break;
    }
    case "customer.subscription.deleted": {
      run(
        "UPDATE workspaces SET plan = 'free', stripe_subscription_id = NULL, billing_interval = NULL WHERE stripe_subscription_id = ? OR id = ?",
        obj.id as string,
        obj.metadata?.workspace_id ?? "",
      );
      break;
    }
  }
  return json({ received: true });
}

/** Checkouts created before the product catalog only carried a plan name. */
function legacyProduct(plan?: string): ProductId | undefined {
  if (plan === "business") return "team_month";
  if (plan === "pro") return "pro_month";
  return undefined;
}
