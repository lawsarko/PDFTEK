import { z } from "zod";
import { all } from "@/lib/db";
import { body, json, publicOrigin, route, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { PRODUCTS, creditHistory, entitlements } from "@/lib/billing";

type P = { params: Promise<{ wid: string }> };

/** Plan, limits, balance, credit history and receipts for Settings → Billing. */
export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const purchases = all<{ id: string; product: string; amount_cents: number; currency: string; created_at: number }>(
    "SELECT id, product, amount_cents, currency, created_at FROM purchases WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20",
    wid,
  ).map((p) => ({ ...p, name: PRODUCTS[p.product as keyof typeof PRODUCTS]?.name ?? p.product }));
  return json({
    entitlements: entitlements(ctx, req),
    hasSubscription: Boolean(ctx.workspace.stripe_subscription_id),
    plan: ctx.workspace.plan,
    ledger: creditHistory(wid),
    purchases,
  });
});

/** Opens the Stripe customer portal (update card, switch monthly/yearly, cancel). */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid, "owner");
  await body(req, z.object({ action: z.literal("portal") }));
  if (!ctx.workspace.stripe_customer_id) throw badRequest("No subscription to manage yet.");
  const portal = await stripe<{ url: string }>("/billing_portal/sessions", {
    customer: ctx.workspace.stripe_customer_id,
    return_url: `${publicOrigin(req)}/app/${wid}/settings?tab=billing`,
  });
  return json({ url: portal.url });
});
