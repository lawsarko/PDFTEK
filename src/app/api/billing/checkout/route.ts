import { z } from "zod";
import { body, json, publicOrigin, route, badRequest, HttpError } from "@/lib/http";
import { currentOrGuest, membership } from "@/lib/auth";
import { get } from "@/lib/db";
import { PRODUCTS, fakePayments, fulfill, paymentsEnabled, type ProductId } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { id } from "@/lib/ids";

const Input = z.object({
  product: z.enum(Object.keys(PRODUCTS) as [ProductId, ...ProductId[]]),
  workspaceId: z.string().max(60).optional(),
  /** Where to come back to afterwards (a path on this site). */
  returnTo: z.string().max(500).optional(),
});

/**
 * Starts a purchase. The Day Pass and credit packs work without an account (visitors get a guest
 * workspace and Stripe asks for an email); subscriptions need a signed-in account. Prices are defined in code (billing.PRODUCTS), so no Stripe price IDs need configuring.
 */
export const POST = route(async (req) => {
  const input = await body(req, Input);
  if (!paymentsEnabled()) throw new HttpError(503, "Payments aren't set up on this server yet.", "payments_disabled");
  const { user, workspaceId: own } = await currentOrGuest(req);
  let wid = own;
  if (input.workspaceId && input.workspaceId !== own) {
    if (!membership(input.workspaceId, user.id)) throw badRequest("You're not a member of that workspace.");
    wid = input.workspaceId;
  }
  const product = PRODUCTS[input.product];
  if (product.mode === "subscription") {
    // Subscriptions belong to an account, so they can be managed, cancelled and never lost. The
    // Day Pass and credit packs still work without one.
    if (user.is_guest) {
      throw new HttpError(403, "Create a free account or sign in to subscribe. Your plan is then tied to your email, so you can always get back to it.", "account_required");
    }
    const role = membership(wid, user.id)?.role;
    if (role !== "owner") throw badRequest("Only the workspace owner can start a subscription.");
    const ws = get<{ plan: string }>("SELECT plan FROM workspaces WHERE id = ?", wid);
    if (ws?.plan === product.plan) throw badRequest("This workspace already has that plan. Manage it from Settings → Billing.");
  }
  const origin = publicOrigin(req);
  const back = input.returnTo?.startsWith("/") && !input.returnTo.startsWith("//") ? input.returnTo : `/app/${wid}`;

  if (fakePayments()) {
    const sessionId = id("fake_");
    fulfill({ workspaceId: wid, product: input.product, sessionId, amountCents: product.cents, email: user.is_guest ? null : user.email });
    return json({ url: `${back}${back.includes("?") ? "&" : "?"}purchased=${input.product}` });
  }

  const ret = `${origin}/api/billing/return?session_id={CHECKOUT_SESSION_ID}&to=${encodeURIComponent(back)}`;
  const priceData = {
    currency: "usd",
    unit_amount: product.cents,
    product_data: { name: product.name, description: product.description },
    ...(product.interval ? { recurring: { interval: product.interval } } : {}),
  };
  const ws = get<{ stripe_customer_id: string | null }>("SELECT stripe_customer_id FROM workspaces WHERE id = ?", wid);
  const session = await stripe<{ url: string }>("/checkout/sessions", {
    mode: product.mode,
    success_url: ret,
    cancel_url: `${origin}${back}`,
    client_reference_id: wid,
    customer: ws?.stripe_customer_id ?? undefined,
    customer_email: ws?.stripe_customer_id || user.is_guest ? undefined : user.email,
    line_items: { 0: { price_data: priceData, quantity: 1 } },
    metadata: { workspace_id: wid, product: input.product },
    ...(product.mode === "subscription"
      ? { subscription_data: { metadata: { workspace_id: wid, product: input.product, plan: product.plan } } }
      : {
          // Stripe refuses customer_creation together with an existing customer (someone who has
          // bought before), so it's only sent for first-time buyers.
          ...(ws?.stripe_customer_id ? {} : { customer_creation: "if_required" }),
          payment_intent_data: { metadata: { workspace_id: wid, product: input.product } },
        }),
    allow_promotion_codes: true,
  });
  return json({ url: session.url });
});
