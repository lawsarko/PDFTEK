import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { get, run, insert } from "./db";
import { id, sha256, token, now } from "./ids";
import { forbidden, unauthorized, notFound, HttpError } from "./http";

export const SESSION_COOKIE = "pdftek_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type User = { id: string; email: string; name: string; created_at: number; is_guest: boolean };
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
  const row = get<Omit<User, "is_guest"> & { is_guest: number; expires_at: number }>(
    `SELECT u.id, u.email, u.name, u.created_at, u.is_guest, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    sha256(raw),
  );
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at, is_guest: Boolean(row.is_guest) };
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

// ---------- guests ----------

/**
 * Visitors can use pdftek without an account: they get a guest user with its own workspace and a
 * normal session cookie, so every tool works unchanged. Signing up later upgrades the same user
 * (keeping files and purchases); signing in to an existing account merges the guest's work into it.
 */
export async function createGuest(req: Request): Promise<{ userId: string; workspaceId: string }> {
  const { clientIp } = await import("./http");
  rateLimit(`guest:${clientIp(req)}`, 30, 3600_000);
  const userId = id("usr_");
  insert("users", {
    id: userId,
    email: `guest-${userId.slice(4).toLowerCase()}@guest.pdftek.invalid`,
    name: "Guest",
    password_hash: "!", // can't sign in with a password
    is_guest: 1,
    created_at: now(),
  });
  const workspaceId = createWorkspace("My documents", userId);
  await createSession(userId, req.headers.get("user-agent"));
  return { userId, workspaceId };
}

/** Current user, creating a guest session when the visitor has none. */
export async function currentOrGuest(req: Request): Promise<{ user: User; workspaceId: string }> {
  const user = await currentUser();
  if (user) return { user, workspaceId: firstWorkspaceFor(user.id) ?? createWorkspace(`${user.name.split(" ")[0]}'s workspace`, user.id) };
  const g = await createGuest(req);
  return { user: (await currentUser())!, workspaceId: g.workspaceId };
}

/** Moves a guest's documents, credits and Day Pass into an account's workspace, then deletes the guest. */
export function mergeGuestInto(guestId: string, targetWorkspaceId: string, targetUserId: string) {
  const ws = get<{
    id: string;
    credits: number;
    pass_until: number | null;
    plan: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    billing_interval: string | null;
  }>(
    `SELECT w.id, w.credits, w.pass_until, w.plan, w.stripe_customer_id, w.stripe_subscription_id, w.billing_interval
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? LIMIT 1`,
    guestId,
  );
  if (ws && ws.id !== targetWorkspaceId) {
    run("UPDATE documents SET workspace_id = ?, created_by = ? WHERE workspace_id = ?", targetWorkspaceId, targetUserId, ws.id);
    run("UPDATE document_versions SET created_by = ? WHERE created_by = ?", targetUserId, guestId);
    run("UPDATE page_text SET workspace_id = ? WHERE workspace_id = ?", targetWorkspaceId, ws.id);
    run("UPDATE purchases SET workspace_id = ? WHERE workspace_id = ?", targetWorkspaceId, ws.id);
    run("UPDATE credit_ledger SET workspace_id = ? WHERE workspace_id = ?", targetWorkspaceId, ws.id);
    run(
      "UPDATE workspaces SET credits = credits + ?, pass_until = MAX(COALESCE(pass_until, 0), ?) WHERE id = ?",
      Math.max(0, ws.credits),
      ws.pass_until ?? 0,
      targetWorkspaceId,
    );
    // A subscription bought as a guest moves too (webhooks find it again by subscription id).
    if (ws.stripe_subscription_id || ws.plan === "pro" || ws.plan === "business") {
      run(
        `UPDATE workspaces SET plan = CASE WHEN plan = 'business' THEN plan ELSE ? END, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id),
           billing_interval = COALESCE(?, billing_interval), allowance_expires_at = NULL WHERE id = ?`,
        ws.plan,
        ws.stripe_customer_id ?? null,
        ws.stripe_subscription_id ?? null,
        ws.billing_interval ?? null,
        targetWorkspaceId,
      );
    }
    run("DELETE FROM workspaces WHERE id = ?", ws.id);
  }
  run("DELETE FROM users WHERE id = ? AND is_guest = 1", guestId);
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
