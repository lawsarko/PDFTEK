import { z } from "zod";
import { run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { appUrl } from "@/lib/mail";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ wid: string }> };

const Input = z.object({ action: z.enum(["trial", "checkout", "portal"]), plan: z.enum(["pro", "business"]).optional() });

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid, "owner");
  const input = await body(req, Input);

  if (input.action === "trial") {
    if (ctx.workspace.trial_ends_at) throw badRequest("This workspace has already used its free trial.");
    run("UPDATE workspaces SET trial_ends_at = ? WHERE id = ?", now() + 14 * 86_400_000, wid);
    logActivity({ workspaceId: wid, userId: ctx.user.id, action: "started_trial" });
    return json({ ok: true });
  }

  if (input.action === "checkout") {
    const plan = input.plan ?? "pro";
    const price = plan === "business" ? process.env.STRIPE_PRICE_BUSINESS : process.env.STRIPE_PRICE_PRO;
    if (!price) throw badRequest("That plan isn't available for purchase on this server.");
    const seats = 1;
    const session = await stripe<{ url: string }>("/checkout/sessions", {
      mode: "subscription",
      success_url: appUrl(`/app/${wid}/settings?tab=billing&checkout=success`),
      cancel_url: appUrl(`/app/${wid}/settings?tab=billing`),
      client_reference_id: wid,
      customer: ctx.workspace.stripe_customer_id ?? undefined,
      customer_email: ctx.workspace.stripe_customer_id ? undefined : ctx.user.email,
      line_items: { 0: { price, quantity: seats } },
      subscription_data: { metadata: { workspace_id: wid, plan } },
      metadata: { workspace_id: wid, plan },
      allow_promotion_codes: true,
    });
    return json({ url: session.url });
  }

  if (!ctx.workspace.stripe_customer_id) throw badRequest("No billing account yet.");
  const portal = await stripe<{ url: string }>("/billing_portal/sessions", {
    customer: ctx.workspace.stripe_customer_id,
    return_url: appUrl(`/app/${wid}/settings?tab=billing`),
  });
  return json({ url: portal.url });
});
