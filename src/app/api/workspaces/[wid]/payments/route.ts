import { z } from "zod";
import { update } from "@/lib/db";
import { badRequest, body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { appUrl } from "@/lib/mail";
import { workspacePayments } from "@/lib/esign";

type P = { params: Promise<{ wid: string }> };

/**
 * Payments collected through signing links go straight to the workspace owner's own Stripe
 * account (Stripe Connect Express). pdftek never holds the money.
 */
export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  return json(workspacePayments(wid));
});

const Input = z.object({ action: z.enum(["connect", "refresh", "dashboard", "disconnect"]) });

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid, "admin");
  const { action } = await body(req, Input);
  const pay = workspacePayments(wid);
  if (!pay.available) throw badRequest("Payments aren't available on this server.");

  if (action === "connect") {
    let accountId = pay.accountId;
    if (!accountId) {
      // Stripe manages the account's risk (losses), onboarding and fees, and the owner gets the
      // Express Dashboard. Stripe no longer accepts the older `type: "express"` setup when the
      // platform isn't covering losses itself.
      const acct = await stripe<{ id: string }>("/accounts", {
        controller: {
          losses: { payments: "stripe" },
          fees: { payer: "account" },
          requirement_collection: "stripe",
          stripe_dashboard: { type: "express" },
        },
        email: ctx.user.email,
        business_profile: { name: ctx.workspace.name },
        metadata: { workspace_id: wid },
      });
      accountId = acct.id;
      update("workspaces", wid, { stripe_account_id: accountId, stripe_account_ready: 0 });
    }
    const back = appUrl(`/app/${wid}/settings?tab=integrations&stripe=return`);
    const link = await stripe<{ url: string }>("/account_links", { account: accountId, type: "account_onboarding", refresh_url: back, return_url: back });
    return json({ url: link.url });
  }
  if (!pay.accountId) throw badRequest("No Stripe account is connected yet.");
  if (action === "refresh") {
    const acct = await stripe<{ charges_enabled: boolean; details_submitted: boolean }>(`/accounts/${pay.accountId}`, {}, "GET");
    update("workspaces", wid, { stripe_account_ready: acct.charges_enabled ? 1 : 0 });
    return json({ ...workspacePayments(wid), detailsSubmitted: acct.details_submitted });
  }
  if (action === "dashboard") {
    const l = await stripe<{ url: string }>(`/accounts/${pay.accountId}/login_links`, {});
    return json({ url: l.url });
  }
  // disconnect: stop using the account here (the Stripe account itself stays with its owner).
  update("workspaces", wid, { stripe_account_id: null, stripe_account_ready: 0 });
  return json(workspacePayments(wid));
});
