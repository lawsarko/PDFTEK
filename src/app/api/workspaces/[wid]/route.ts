import { z } from "zod";
import { get, run } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { mailConfigured } from "@/lib/mail";
import { hasServerOffice } from "@/lib/pdf";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const stats = get<{ docs: number; pages: number }>(
    "SELECT COUNT(*) AS docs, COALESCE(SUM(page_count),0) AS pages FROM documents WHERE workspace_id = ? AND deleted_at IS NULL",
    wid,
  )!;
  return json({
    workspace: {
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      plan: ctx.plan,
      basePlan: ctx.workspace.plan,
      trialEndsAt: ctx.workspace.trial_ends_at,
      playbook: ctx.workspace.playbook,
      hasSubscription: Boolean(ctx.workspace.stripe_subscription_id),
    },
    role: ctx.role,
    me: ctx.user,
    stats,
    capabilities: {
      ai: aiConfigured(),
      email: mailConfigured(),
      serverOffice: await hasServerOffice(),
      billing: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  playbook: z.string().max(20000).optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await requireMember(wid, "admin");
  const input = await body(req, Patch);
  if (input.name !== undefined) run("UPDATE workspaces SET name = ? WHERE id = ?", input.name, wid);
  if (input.playbook !== undefined) run("UPDATE workspaces SET playbook = ? WHERE id = ?", input.playbook, wid);
  return json({ ok: true });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid, "owner");
  run("DELETE FROM page_text WHERE workspace_id = ?", wid);
  run("DELETE FROM workspaces WHERE id = ?", wid);
  return json({ ok: true });
});
