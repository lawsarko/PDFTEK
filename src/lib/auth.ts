import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { get, run, insert } from "./db";
import { id, sha256, token, now } from "./ids";
import { forbidden, unauthorized, notFound, paymentRequired, HttpError } from "./http";

export const SESSION_COOKIE = "pdftek_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type User = { id: string; email: string; name: string; created_at: number };
export type Role = "owner" | "admin" | "member";
export type Plan = "free" | "pro" | "business";
export type Workspace = {
  id: string;
  name: string;
  plan: Plan;
  trial_ends_at: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  playbook: string;
  created_at: number;
};

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- sessions ----------

export async function createSession(userId: string, userAgent?: string | null) {
  const raw = token(32);
  insert("sessions", {
    id: sha256(raw),
    user_id: userId,
    expires_at: now() + SESSION_TTL_MS,
    created_at: now(),
    user_agent: userAgent?.slice(0, 200) ?? null,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) run("DELETE FROM sessions WHERE id = ?", sha256(raw));
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const row = get<User & { expires_at: number }>(
    `SELECT u.id, u.email, u.name, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    sha256(raw),
  );
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at };
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  return user;
}

// ---------- workspaces ----------

export function effectivePlan(ws: Pick<Workspace, "plan" | "trial_ends_at">): Plan {
  if (ws.plan !== "free") return ws.plan;
  if (ws.trial_ends_at && ws.trial_ends_at > now()) return "pro";
  return "free";
}

export function membership(workspaceId: string, userId: string) {
  return get<{ role: Role }>(
    "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?",
    workspaceId,
    userId,
  );
}

export type Ctx = { user: User; workspace: Workspace; role: Role; plan: Plan };

export async function requireMember(workspaceId: string, minRole: Role = "member"): Promise<Ctx> {
  const user = await requireUser();
  const workspace = get<Workspace>("SELECT * FROM workspaces WHERE id = ?", workspaceId);
  if (!workspace) throw notFound("Workspace not found.");
  const m = membership(workspaceId, user.id);
  if (!m) throw forbidden("You're not a member of this workspace.");
  const rank: Record<Role, number> = { member: 0, admin: 1, owner: 2 };
  if (rank[m.role] < rank[minRole]) throw forbidden(`This action requires the ${minRole} role.`);
  return { user, workspace, role: m.role, plan: effectivePlan(workspace) };
}

export function requirePlan(ctx: Ctx, feature: string) {
  if (ctx.plan === "free") {
    throw paymentRequired(`${feature} is a Pro feature. Start a free 14-day trial from Settings → Billing.`);
  }
}

export function createWorkspace(name: string, ownerId: string): string {
  const wsId = id("ws_");
  insert("workspaces", { id: wsId, name, plan: "free", playbook: DEFAULT_PLAYBOOK, created_at: now() });
  insert("memberships", { workspace_id: wsId, user_id: ownerId, role: "owner", created_at: now() });
  return wsId;
}

export function firstWorkspaceFor(userId: string): string | undefined {
  return get<{ workspace_id: string }>(
    "SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1",
    userId,
  )?.workspace_id;
}

// ---------- rate limiting ----------

export function rateLimit(key: string, limit: number, windowMs: number) {
  const t = now();
  const row = get<{ count: number; window_start: number }>("SELECT count, window_start FROM rate_limits WHERE key = ?", key);
  if (!row || t - row.window_start > windowMs) {
    run(
      "INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start",
      key,
      t,
    );
    return;
  }
  if (row.count >= limit) throw new HttpError(429, "Too many attempts. Please wait a moment and try again.");
  run("UPDATE rate_limits SET count = count + 1 WHERE key = ?", key);
}

export const DEFAULT_PLAYBOOK = `Contract review playbook (edit in Settings → Workspace):
- Initial term: 12–36 months acceptable; flag auto-renewal without at least 30 days' notice window.
- Termination for convenience: we require the right to terminate on 90 days' notice or less.
- Cure period for material breach: 30 days minimum.
- Limitation of liability: cap at 12 months' fees; carve-outs only for confidentiality, IP infringement, and gross negligence.
- Indemnification: mutual; flag one-sided indemnities.
- Governing law: prefer Delaware or New York.
- Payment terms: net 30 or longer; flag late fees above 1.5% per month.
- Confidentiality: survives at least 3 years after termination.
- Data protection: DPA required when personal data is processed; flag missing breach-notification timelines.`;
