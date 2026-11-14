import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { checkTasks, commitTasks, entitlements, requireMembership } from "@/lib/billing";

type P = { params: Promise<{ wid: string }> };

/** Plan, limits, today's usage and credit balance, for the app's usage meter and paywall. */
export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  return json(entitlements(ctx, req));
});

const Input = z.discriminatedUnion("action", [
  // Tools that run in the browser (PDF → PowerPoint/images/text) report a task before running.
  z.object({ action: z.literal("task"), label: z.string().trim().min(1).max(60) }),
  // Browser-only features that need a pass or membership (read aloud).
  z.object({ action: z.literal("membership"), feature: z.string().trim().min(1).max(60) }),
]);

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const input = await body(req, Input);
  if (input.action === "membership") requireMembership(ctx, input.feature);
  else commitTasks(checkTasks(ctx, req, 1, input.label));
  return json(entitlements(ctx, req));
});
