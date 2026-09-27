import { run } from "@/lib/db";
import { json } from "@/lib/http";
import { verifyStripeSignature } from "@/lib/stripe";

type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> & { metadata?: Record<string, string> } };
};

export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"))) return json({ error: "bad signature" }, 400);
  const event = JSON.parse(payload) as StripeEvent;
  const obj = event.data.object;
  const wid = obj.metadata?.workspace_id ?? (obj.client_reference_id as string | undefined);
  if (!wid) return json({ received: true });

  switch (event.type) {
    case "checkout.session.completed":
      run(
        "UPDATE workspaces SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?",
        obj.metadata?.plan === "business" ? "business" : "pro",
        obj.customer as string,
        obj.subscription as string,
        wid,
      );
      break;
    case "customer.subscription.updated": {
      const active = ["active", "trialing", "past_due"].includes(obj.status as string);
      run("UPDATE workspaces SET plan = ? WHERE id = ?", active ? (obj.metadata?.plan === "business" ? "business" : "pro") : "free", wid);
      break;
    }
    case "customer.subscription.deleted":
      run("UPDATE workspaces SET plan = 'free', stripe_subscription_id = NULL WHERE id = ?", wid);
      break;
  }
  return json({ received: true });
}
