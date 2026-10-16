import "server-only";
import { all, get, insert, run, tx } from "./db";
import { id, now } from "./ids";
import { HttpError, clientIp } from "./http";
import type { Ctx } from "./auth";

/**
 * pdftek's business model.
 *
 *  - Everyone (signed in or not) gets the everyday tools free up to a daily task limit.
 *  - Past the limit, a task costs credits; or buy a Day Pass / Pro for unlimited tasks.
 *  - Edit, Read aloud, e-signatures, document requests and automations need a Day Pass or a
 *    membership.
 *  - Anything that calls the AI is paid with credits, metered on the real API cost. Passes and
 *    memberships include credits; credit packs top up and never expire.
 */

export type Tier = "guest" | "free" | "pass" | "pro" | "team" | "admin";

export { FREE_LIMITS, PAID_LIMITS, EXTRA_TASK_CREDITS, AI_MIN_CREDITS, PRODUCTS, type ProductId } from "./plans";
import { FREE_LIMITS, PAID_LIMITS, EXTRA_TASK_CREDITS, AI_MIN_CREDITS, PRODUCTS, type ProductId, type Entitlements } from "./plans";
export type { Entitlements };
/** 1 credit buys this many dollars of AI usage at the API's list price (≈1.8× markup at pack prices). */
const USD_PER_CREDIT = 1 / 150;

/** Monthly AI credits included with each membership. */
const MONTHLY_ALLOWANCE: Record<"pro" | "business", number> = { pro: 400, business: 1500 };

// ---------- entitlements ----------

type WsBilling = {
  plan: string;
  trial_ends_at: number | null;
  pass_until: number | null;
  credits: number;
  allowance_credits: number;
  allowance_expires_at: number | null;
};

function isAdmin(email: string) {
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

function wsBilling(workspaceId: string): WsBilling {
  return get<WsBilling>(
    "SELECT plan, trial_ends_at, pass_until, credits, allowance_credits, allowance_expires_at FROM workspaces WHERE id = ?",
    workspaceId,
  )!;
}

export function tierOf(ctx: Ctx): Tier {
  if (isAdmin(ctx.user.email)) return "admin";
  const ws = wsBilling(ctx.workspace.id);
  if (ws.plan === "business") return "team";
  if (ws.plan === "pro" || (ws.trial_ends_at && ws.trial_ends_at > now())) return "pro";
  if (ws.pass_until && ws.pass_until > now()) return "pass";
  return ctx.user.is_guest ? "guest" : "free";
}

const day = () => new Date().toISOString().slice(0, 10);

function usedToday(subject: string) {
  return get<{ tasks: number }>("SELECT tasks FROM usage_daily WHERE subject = ? AND day = ?", subject, day())?.tasks ?? 0;
}

/** Guests are also counted per IP, so clearing cookies doesn't reset the free limit. */
function subjects(ctx: Ctx, req?: Request) {
  const list = [`ws:${ctx.workspace.id}`];
  if (ctx.user.is_guest && req) list.push(`ip:${clientIp(req)}`);
  return list;
}

/** Refills a member's monthly AI credits when the previous allowance has run out. */
function refillAllowance(workspaceId: string) {
  const ws = wsBilling(workspaceId);
  if (ws.plan !== "pro" && ws.plan !== "business") return;
  if (ws.allowance_expires_at && ws.allowance_expires_at > now()) return;
  const amount = MONTHLY_ALLOWANCE[ws.plan];
  run("UPDATE workspaces SET allowance_credits = ?, allowance_expires_at = ? WHERE id = ?", amount, now() + 30 * 86_400_000, workspaceId);
  ledger(workspaceId, amount, "Monthly AI credits", { plan: ws.plan });
}


export function entitlements(ctx: Ctx, req?: Request): Entitlements {
  refillAllowance(ctx.workspace.id);
  const tier = tierOf(ctx);
  const ws = wsBilling(ctx.workspace.id);
  const paid = tier !== "guest" && tier !== "free";
  const limits = paid ? PAID_LIMITS : FREE_LIMITS[tier as "guest" | "free"];
  const allowance = ws.allowance_expires_at && ws.allowance_expires_at > now() ? ws.allowance_credits : 0;
  return {
    tier,
    membership: paid,
    tasksToday: Math.max(...subjects(ctx, req).map(usedToday)),
    taskLimit: paid ? null : limits.tasksPerDay,
    maxFileMb: limits.maxFileMb,
    maxFiles: limits.maxFiles,
    passUntil: ws.pass_until && ws.pass_until > now() ? ws.pass_until : null,
    credits: ws.credits,
    allowance,
    allowanceExpiresAt: allowance ? ws.allowance_expires_at : null,
    paymentsEnabled: paymentsEnabled(),
    guest: ctx.user.is_guest,
    purchaseEmail: ctx.user.is_guest ? guestPurchaseEmail(ctx.workspace.id) : null,
  };
}

const totalCredits = (e: Entitlements) => e.credits + e.allowance;

// ---------- gates ----------

export function requireMembership(ctx: Ctx, feature: string) {
  if (entitlements(ctx).membership) return;
  throw new HttpError(402, `${feature} needs a Day Pass ($1.99 for 24 hours) or pdftek Pro.`, "membership_required");
}

export function assertFileSize(ctx: Ctx, bytes: number, name?: string) {
  const { maxFileMb, membership } = entitlements(ctx);
  if (bytes <= maxFileMb * 1024 * 1024) return;
  throw new HttpError(
    402,
    `${name ? `${name} is` : "This file is"} larger than ${maxFileMb} MB.${membership ? "" : " Free files can be up to 20 MB; a Day Pass or Pro allows up to 100 MB."}`,
    membership ? "too_large" : "file_too_large",
  );
}

export function assertBatch(ctx: Ctx, count: number) {
  const { maxFiles, membership } = entitlements(ctx);
  if (count <= maxFiles) return;
  throw new HttpError(402, `The free plan handles up to ${maxFiles} files at a time. Get a Day Pass or Pro to process up to ${PAID_LIMITS.maxFiles} at once.`, membership ? "too_many" : "batch_limit");
}

// ---------- task metering ----------

export type TaskTicket = { ctx: Ctx; subjects: string[]; count: number; creditCost: number; label: string };

/**
 * Checks that `count` tasks may run now. Within the free daily limit they're free; past it they
 * cost credits when the balance allows, otherwise this throws 402 `limit_reached`.
 */
export function checkTasks(ctx: Ctx, req: Request | undefined, count: number, label: string): TaskTicket {
  const e = entitlements(ctx, req);
  const subs = subjects(ctx, req);
  if (e.taskLimit === null || e.tasksToday + count <= e.taskLimit) return { ctx, subjects: subs, count, creditCost: 0, label };
  const over = Math.min(count, e.tasksToday + count - e.taskLimit);
  const cost = over * EXTRA_TASK_CREDITS;
  if (totalCredits(e) >= cost) return { ctx, subjects: subs, count, creditCost: cost, label };
  throw new HttpError(
    402,
    `You've used today's ${e.taskLimit} free tasks. Get a Day Pass for unlimited tasks, or credits to keep going (${EXTRA_TASK_CREDITS} credits per task).`,
    "limit_reached",
  );
}

/** Records tasks that completed (and charges credits for any beyond the free limit). */
export function commitTasks(t: TaskTicket) {
  for (const s of t.subjects) {
    run(
      "INSERT INTO usage_daily (subject, day, tasks) VALUES (?, ?, ?) ON CONFLICT(subject, day) DO UPDATE SET tasks = tasks + excluded.tasks",
      s,
      day(),
      t.count,
    );
  }
  if (t.creditCost) spendCredits(t.ctx.workspace.id, t.creditCost, `Extra task: ${t.label}`);
}

/** Runs `fn` as metered task(s): checked before, recorded only if it succeeds. */
export async function metered<T>(ctx: Ctx, req: Request | undefined, label: string, fn: () => Promise<T>, count = 1): Promise<T> {
  const ticket = checkTasks(ctx, req, count, label);
  const out = await fn();
  commitTasks(ticket);
  return out;
}

// ---------- credits ----------

function ledger(workspaceId: string, delta: number, reason: string, meta: Record<string, unknown> = {}) {
  insert("credit_ledger", { id: id("cl_"), workspace_id: workspaceId, delta, reason, meta_json: JSON.stringify(meta), created_at: now() });
}

export function grantCredits(workspaceId: string, amount: number, reason: string, meta: Record<string, unknown> = {}) {
  run("UPDATE workspaces SET credits = credits + ? WHERE id = ?", amount, workspaceId);
  ledger(workspaceId, amount, reason, meta);
}

/** Spends the monthly allowance first, then purchased credits. The balance may dip below zero once. */
export function spendCredits(workspaceId: string, amount: number, reason: string, meta: Record<string, unknown> = {}) {
  if (amount <= 0) return;
  tx(() => {
    const ws = wsBilling(workspaceId);
    const allowance = ws.allowance_expires_at && ws.allowance_expires_at > now() ? ws.allowance_credits : 0;
    const fromAllowance = Math.min(allowance, amount);
    run(
      "UPDATE workspaces SET allowance_credits = allowance_credits - ?, credits = credits - ? WHERE id = ?",
      fromAllowance,
      amount - fromAllowance,
      workspaceId,
    );
    ledger(workspaceId, -amount, reason, meta);
  });
}

// ---------- AI metering ----------

/** API list prices per million tokens: [input, output, cache write, cache read]. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 5, 0.2],
  "claude-opus-5": [5, 25, 6.25, 0.5],
  "claude-sonnet-5-5": [2, 10, 2.5, 0.2],
  "claude-sonnet-5": [2, 10, 2.5, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.125, 0.01],
  "claude-fable-5-1": [10, 50, 12.5, 0.25],
};

export type AiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function aiCostUsd(model: string, u: AiUsage) {
  const [i, o, cw, cr] = PRICES[model] ?? PRICES["claude-opus-5"];
  return (u.input_tokens * i + u.output_tokens * o + (u.cache_creation_input_tokens ?? 0) * cw + (u.cache_read_input_tokens ?? 0) * cr) / 1e6;
}

/** Throws 402 `credits_required` unless the workspace can pay for an AI request. */
export function assertAiCredits(ctx: Ctx) {
  const e = entitlements(ctx);
  if (e.tier === "admin" || totalCredits(e) >= AI_MIN_CREDITS) return;
  throw new HttpError(
    402,
    e.membership
      ? "You've used this month's AI credits. Top up with a credit pack (from $2.99) to keep asking."
      : "AI features use credits. Get 250 credits for $2.99, a Day Pass ($1.99, includes 50), or Pro (400 a month).",
    "credits_required",
  );
}

/** Charges the real cost of a finished AI request. Returns the credits spent. */
export function chargeAi(ctx: Ctx, model: string, usage: AiUsage, reason: string): number {
  if (tierOf(ctx) === "admin") return 0;
  const credits = Math.max(1, Math.ceil(aiCostUsd(model, usage) / USD_PER_CREDIT));
  spendCredits(ctx.workspace.id, credits, reason, { model, input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens ?? 0 });
  return credits;
}

/** Same as chargeAi for background jobs (automations) that have no user context. */
export function chargeAiWorkspace(workspaceId: string, model: string, usage: AiUsage, reason: string) {
  const credits = Math.max(1, Math.ceil(aiCostUsd(model, usage) / USD_PER_CREDIT));
  spendCredits(workspaceId, credits, reason, { model });
  return credits;
}

export function workspaceCanUseAi(workspaceId: string) {
  const ws = wsBilling(workspaceId);
  const allowance = ws.allowance_expires_at && ws.allowance_expires_at > now() ? ws.allowance_credits : 0;
  return ws.credits + allowance >= AI_MIN_CREDITS;
}

// ---------- payments ----------

export function paymentsEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY) || fakePayments();
}

/** Test mode: purchases complete instantly without Stripe. Never enable in production. */
export function fakePayments() {
  return process.env.PDFTEK_FAKE_PAYMENTS === "1" && process.env.NODE_ENV !== "production";
}

export type Fulfilment = {
  workspaceId: string;
  product: ProductId;
  sessionId: string;
  amountCents: number;
  currency?: string;
  email?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
};

/** Grants what was bought. Safe to call more than once for the same checkout session. */
export function fulfill(f: Fulfilment): boolean {
  const p = PRODUCTS[f.product];
  if (!p) return false;
  return tx(() => {
    if (get("SELECT id FROM purchases WHERE stripe_session_id = ?", f.sessionId)) return false;
    insert("purchases", {
      id: id("pur_"),
      workspace_id: f.workspaceId,
      product: f.product,
      amount_cents: f.amountCents,
      currency: f.currency ?? "usd",
      email: f.email ?? null,
      stripe_session_id: f.sessionId,
      created_at: now(),
    });
    if (p.passHours) {
      const ws = wsBilling(f.workspaceId);
      const start = Math.max(now(), ws.pass_until ?? 0);
      const until = start + p.passHours * 3_600_000;
      run("UPDATE workspaces SET pass_until = ? WHERE id = ?", until, f.workspaceId);
    }
    if (p.credits) grantCredits(f.workspaceId, p.credits, p.name, { session: f.sessionId });
    if (p.plan) {
      run(
        "UPDATE workspaces SET plan = ?, billing_interval = ?, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id), allowance_expires_at = NULL WHERE id = ?",
        p.plan,
        p.interval ?? null,
        f.customerId ?? null,
        f.subscriptionId ?? null,
        f.workspaceId,
      );
    }
    return true;
  });
}

export function creditHistory(workspaceId: string, limit = 30) {
  return (
    all<{ id: string; delta: number; reason: string; created_at: number }>(
      "SELECT id, delta, reason, created_at FROM credit_ledger WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
      workspaceId,
      limit,
    ) ?? []
  );
}

// ---------- housekeeping ----------

/**
 * Deletes guest accounts (and their files) 24 hours after they were created. Guests who still have
 * something they paid for (a subscription, an unexpired pass, credits, or a purchase in the last 90
 * days) are kept, so they can come back and save it to an account.
 */
export async function cleanupGuests() {
  const { deleteFile } = await import("./storage");
  const cutoff = now() - 24 * 3_600_000;
  const paidCutoff = now() - 90 * 86_400_000;
  const guests = all<{ user_id: string; workspace_id: string | null; created_at: number }>(
    `SELECT u.id AS user_id, m.workspace_id, u.created_at FROM users u LEFT JOIN memberships m ON m.user_id = u.id
      WHERE u.is_guest = 1 AND u.created_at < ? LIMIT 500`,
    cutoff,
  );
  for (const g of guests) {
    // Never delete a guest who still has something they paid for.
    if (g.workspace_id && guestHasValue(g.workspace_id, paidCutoff)) continue;
    if (g.workspace_id) {
      const keys = all<{ storage_key: string }>(
        "SELECT v.storage_key FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.workspace_id = ?",
        g.workspace_id,
      );
      for (const k of keys) await deleteFile(k.storage_key).catch(() => {});
      run("DELETE FROM page_text WHERE workspace_id = ?", g.workspace_id);
      run("DELETE FROM workspaces WHERE id = ?", g.workspace_id);
      run("DELETE FROM usage_daily WHERE subject = ?", `ws:${g.workspace_id}`);
    }
    run("DELETE FROM users WHERE id = ?", g.user_id);
  }
  run("DELETE FROM usage_daily WHERE day < ?", new Date(now() - 7 * 86_400_000).toISOString().slice(0, 10));
  return guests.length;
}

function guestHasValue(workspaceId: string, paidCutoff: number) {
  const ws = get<{ plan: string; pass_until: number | null; credits: number }>(
    "SELECT plan, pass_until, credits FROM workspaces WHERE id = ?",
    workspaceId,
  );
  if (!ws) return false;
  if (ws.plan === "pro" || ws.plan === "business") return true;
  if (ws.pass_until && ws.pass_until > now()) return true;
  if (ws.credits > 0) return true;
  return Boolean(get("SELECT 1 FROM purchases WHERE workspace_id = ? AND created_at > ?", workspaceId, paidCutoff));
}

/** Email a guest gave Stripe at checkout (pre-fills "create your account"). */
export function guestPurchaseEmail(workspaceId: string): string | null {
  return get<{ email: string | null }>("SELECT email FROM purchases WHERE workspace_id = ? AND email IS NOT NULL ORDER BY created_at DESC LIMIT 1", workspaceId)?.email ?? null;
}
