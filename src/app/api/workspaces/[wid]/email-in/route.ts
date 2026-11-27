import { z } from "zod";
import { run } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { entitlements, requireMembership } from "@/lib/billing";
import { enableInbox, inbox, inboxAddress, inboundDomain, recentMessages } from "@/lib/email-in";

type P = { params: Promise<{ wid: string }> };

function state(wid: string, membership: boolean) {
  const row = inbox(wid);
  return {
    available: Boolean(inboundDomain() && process.env.INBOUND_EMAIL_SECRET?.trim()),
    address: inboxAddress(wid, row),
    allow: row?.allow ?? "members",
    membership,
    recent: row ? recentMessages(wid) : [],
  };
}

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  return json(state(wid, entitlements(ctx).membership));
});

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("regenerate") }),
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("allow"), allow: z.enum(["members", "anyone"]) }),
]);

/** Turn the workspace's email address on or off, give it a new address, or choose who may send. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid, "admin");
  const input = await body(req, Input);
  if (input.action === "enable" || input.action === "regenerate") {
    requireMembership(ctx, "Email in");
    enableInbox(wid, ctx.user.id, input.action === "regenerate");
  } else if (input.action === "disable") run("DELETE FROM email_inboxes WHERE workspace_id = ?", wid);
  else run("UPDATE email_inboxes SET allow = ? WHERE workspace_id = ?", input.allow, wid);
  return json(state(wid, entitlements(ctx).membership));
});
