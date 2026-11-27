import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { all, get, insert, run, update } from "./db";
import { id, now, sha256, token } from "./ids";
import { HttpError, badRequest, notFound, unauthorized } from "./http";
import { mailConfigured, sendMail } from "./mail";
import { rateLimit } from "./auth";
import { brand, ensureSlug, firmBySlug, firmDisplayName, firmOf, portalUrl, type FirmRow } from "./firm";
import { clientFiles, getClient, messages, type ClientRow, type FileRow } from "./clients";
import { itemView, items, statusOf, type RequestRow } from "./requests";
import { stripe } from "./stripe";
import { workspacePayments, formatMoney } from "./esign";
import { logActivity, notify } from "./activity";
import { stageLabel } from "./client-shared";
import type { Ctx } from "./auth";

/**
 * The client portal: where a firm's clients see what's asked of them, upload, read messages, sign
 * and download what the firm shared. No passwords: clients sign in with a 6-digit code or a
 * one-click link emailed to the address the firm has on file. Codes are stored as hashes, expire
 * in 15 minutes and lock after 5 wrong tries; sessions last 7 days.
 */

const CODE_TTL = 15 * 60_000;
const INVITE_TTL = 7 * 86_400_000;
const SESSION_TTL = 7 * 86_400_000;
const MAX_TRIES = 5;

export const portalCookie = (slug: string) => `pdftek-portal-${slug}`;

export function firmForSlug(slug: string): FirmRow {
  const f = firmBySlug(slug);
  if (!f) throw notFound("This portal address doesn't exist.");
  return f;
}

const hashCode = (clientId: string, code: string) => sha256(`portal:${clientId}:${code.replace(/\D/g, "")}`);

async function issueLogin(c: ClientRow, ttl: number) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const link = token(32);
  run("DELETE FROM client_login_codes WHERE client_id = ? AND (used_at IS NOT NULL OR expires_at < ?)", c.id, now());
  insert("client_login_codes", { id: id("clc_"), client_id: c.id, code_hash: hashCode(c.id, code), link_hash: sha256(link), expires_at: now() + ttl, created_at: now() });
  return { code, link };
}

/** Sends a sign-in code and link. Answers the same whether or not the email is a client (no fishing for addresses). */
export async function requestLogin(slug: string, email: string, ip: string) {
  rateLimit(`portal-login:${ip}`, 10, 15 * 60_000);
  rateLimit(`portal-login:${slug}:${email.toLowerCase()}`, 4, 15 * 60_000);
  const f = firmForSlug(slug);
  // Checked first, so the answer never depends on whether the address is a client's.
  if (!mailConfigured()) throw new HttpError(503, "Email isn't set up on this server, so sign-in codes can't be sent. Please contact your firm.");
  const c = get<ClientRow>("SELECT * FROM clients WHERE workspace_id = ? AND email = ? AND archived_at IS NULL", f.id, email.trim().toLowerCase());
  if (!c) return;
  const { code, link } = await issueLogin(c, CODE_TTL);
  const firm = firmDisplayName(f);
  await sendMail({
    to: c.email,
    subject: `${code} is your sign-in code for ${firm}`,
    heading: `Your sign-in code: ${code}`,
    paragraphs: [`Enter this code to open your secure portal with ${firm}, or use the button below. Both expire in 15 minutes.`, "If you didn't try to sign in, you can ignore this email."],
    cta: { label: "Sign in", url: `${portalUrl(slug)}?login=${link}` },
    footer: `Sent by pdftek for ${firm}.`,
  });
}

/** The firm invites a client: an email with a one-click sign-in that lasts 7 days. */
export async function inviteClient(ctx: Ctx, clientId: string) {
  const c = getClient(ctx.workspace.id, clientId);
  if (c.archived_at) throw badRequest("This client is archived.");
  const slug = ensureSlug(ctx.workspace.id);
  const firm = firmDisplayName(firmOf(ctx.workspace.id));
  const { link } = await issueLogin(c, INVITE_TTL);
  const url = `${portalUrl(slug)}?login=${link}`;
  const { delivered, error } = await sendMail({
    to: c.email,
    subject: `${firm} invited you to your secure client portal`,
    heading: `Welcome to ${firm}'s client portal`,
    paragraphs: [
      `Hi ${c.name.split(" ")[0]}, ${ctx.user.name} at ${firm} set up a secure portal for you. Use it to upload documents, see what's still needed, message the team and download what they share with you.`,
      "There's no password to remember: each time you sign in, we email you a code. The button below signs you in directly for the next 7 days.",
    ],
    cta: { label: "Open my portal", url },
    replyTo: ctx.user.email,
    footer: `Sent by pdftek for ${firm}. Your documents are encrypted in transit and shared only with ${firm}.`,
  });
  update("clients", c.id, { invited_at: now() });
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client_invited", meta: { name: c.name } });
  return { delivered, mailError: delivered ? null : (error ?? null), url: delivered ? null : url };
}

async function startSession(c: ClientRow, slug: string) {
  const raw = token(32);
  run("DELETE FROM client_sessions WHERE expires_at < ?", now());
  insert("client_sessions", { id: sha256(raw), client_id: c.id, expires_at: now() + SESSION_TTL, created_at: now() });
  update("clients", c.id, { last_login_at: now() });
  (await cookies()).set(portalCookie(slug), raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https"),
    path: "/",
    maxAge: SESSION_TTL / 1000,
  });
}

export async function verifyCode(slug: string, email: string, code: string, ip: string) {
  rateLimit(`portal-verify:${ip}`, 30, 15 * 60_000);
  const f = firmForSlug(slug);
  const c = get<ClientRow>("SELECT * FROM clients WHERE workspace_id = ? AND email = ? AND archived_at IS NULL", f.id, email.trim().toLowerCase());
  const row = c && get<{ id: string; code_hash: string; attempts: number; expires_at: number }>(
    "SELECT id, code_hash, attempts, expires_at FROM client_login_codes WHERE client_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
    c.id,
  );
  if (!c || !row || row.expires_at < now()) throw badRequest("That code has expired. Ask for a new one.");
  if (row.attempts >= MAX_TRIES) throw new HttpError(429, "Too many wrong codes. Ask for a new one.");
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashCode(c.id, code)));
  if (!ok) {
    run("UPDATE client_login_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
    const left = MAX_TRIES - row.attempts - 1;
    throw badRequest(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Ask for a new one.");
  }
  run("UPDATE client_login_codes SET used_at = ? WHERE id = ?", now(), row.id);
  await startSession(c, slug);
}

/** One-click sign-in from an email link. Returns false when the link is no longer valid. */
export async function verifyLink(slug: string, link: string) {
  const f = firmBySlug(slug);
  if (!f) return false;
  const row = get<{ id: string; client_id: string; expires_at: number }>(
    `SELECT l.id, l.client_id, l.expires_at FROM client_login_codes l JOIN clients c ON c.id = l.client_id
      WHERE l.link_hash = ? AND l.used_at IS NULL AND c.workspace_id = ? AND c.archived_at IS NULL`,
    sha256(link),
    f.id,
  );
  if (!row || row.expires_at < now()) return false;
  run("UPDATE client_login_codes SET used_at = ? WHERE id = ?", now(), row.id);
  await startSession(getClient(f.id, row.client_id), slug);
  return true;
}

export async function signOut(slug: string) {
  const jar = await cookies();
  const raw = jar.get(portalCookie(slug))?.value;
  if (raw) run("DELETE FROM client_sessions WHERE id = ?", sha256(raw));
  jar.delete(portalCookie(slug));
}

export async function currentClient(slug: string): Promise<{ client: ClientRow; firm: FirmRow } | null> {
  const f = firmBySlug(slug);
  if (!f) return null;
  const raw = (await cookies()).get(portalCookie(slug))?.value;
  if (!raw) return null;
  const s = get<{ client_id: string; expires_at: number }>("SELECT client_id, expires_at FROM client_sessions WHERE id = ?", sha256(raw));
  if (!s || s.expires_at < now()) return null;
  const c = get<ClientRow>("SELECT * FROM clients WHERE id = ? AND workspace_id = ? AND archived_at IS NULL", s.client_id, f.id);
  return c ? { client: c, firm: f } : null;
}

export async function requireClient(slug: string) {
  const who = await currentClient(slug);
  if (!who) throw unauthorized("Please sign in to your portal.");
  return who;
}

// ---------- what the client sees ----------

export function portalHome(c: ClientRow, f: FirmRow) {
  const reqs = all<RequestRow>("SELECT * FROM doc_requests WHERE client_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 60", c.id);
  const open = reqs.filter((r) => ["pending", "viewed", "in_progress"].includes(statusOf(r)));
  // Opening the portal counts as the client having seen these requests.
  for (const r of open) if (!r.viewed_at) run("UPDATE doc_requests SET viewed_at = ?, status = CASE WHEN status = 'pending' THEN 'viewed' ELSE status END WHERE id = ?", now(), r.id);
  const toSign = all<{ token: string; title: string; created_at: number }>(
    `SELECT s.token, r.title, r.created_at FROM signers s JOIN signature_requests r ON r.id = s.request_id
      WHERE r.workspace_id = ? AND lower(s.email) = ? AND s.status IN ('pending','viewed') AND r.status IN ('pending','in_progress','sent')
      ORDER BY r.created_at DESC LIMIT 20`,
    f.id,
    c.email,
  );
  const stages = all<{ year: number; service: string; status: string }>("SELECT year, service, status FROM client_engagements WHERE client_id = ? ORDER BY year DESC LIMIT 6", c.id);
  return {
    firm: brand(f),
    client: { name: c.name, email: c.email, kind: c.kind },
    requests: reqs.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      dueDate: r.due_date,
      year: r.year,
      status: statusOf(r),
      items: items(r.id).map(itemView).map(({ documentId: _d, ...i }) => i),
    })),
    files: clientFiles(c.id, { forClient: true }).map(({ ai: _a, ...f }) => f),
    messages: messages(c.id, true),
    toSign: toSign.map((s) => ({ title: s.title, url: `/sign/${s.token}`, createdAt: s.created_at })),
    progress: stages.map((s) => ({ year: s.year, service: s.service, stage: s.status, label: stageLabel(s.status) })),
  };
}

export function clientRequest(c: ClientRow, requestId: string) {
  const r = get<RequestRow>("SELECT * FROM doc_requests WHERE id = ? AND client_id = ?", requestId, c.id);
  if (!r) throw notFound("Request not found.");
  return r;
}

/** A file the client may open: their own uploads, or shared ones that are paid for (when payment is required). */
export function clientFile(c: ClientRow, fileId: string) {
  const f = get<FileRow>("SELECT * FROM client_files WHERE id = ? AND client_id = ? AND (source = 'client' OR shared = 1)", fileId, c.id);
  if (!f) throw notFound("File not found.");
  if (f.pay_cents && !f.paid_at) throw new HttpError(402, `This document unlocks once the invoice (${formatMoney(f.pay_cents, f.pay_currency ?? "usd")}) is paid.`);
  if (f.source === "firm" && !f.client_viewed_at) {
    run("UPDATE client_files SET client_viewed_at = ? WHERE id = ?", now(), f.id);
    logActivity({ workspaceId: c.workspace_id, actorLabel: c.name, action: "client_file_opened", documentId: f.document_id, meta: { name: c.name } });
  }
  return f;
}

// ---------- pay to unlock ----------

export async function payCheckout(c: ClientRow, slug: string, fileId: string) {
  const f = get<FileRow>("SELECT * FROM client_files WHERE id = ? AND client_id = ? AND shared = 1", fileId, c.id);
  if (!f || !f.pay_cents) throw badRequest("There's nothing to pay here.");
  if (f.paid_at) throw badRequest("This invoice is already paid.");
  const pay = workspacePayments(c.workspace_id);
  if (!pay.accountId || !pay.ready) throw badRequest("Online payment isn't set up yet. Please contact your firm.");
  const back = portalUrl(slug, "?tab=documents");
  const join = back.includes("?") ? "&" : "?";
  const session = await stripe<{ id: string; url: string }>(
    "/checkout/sessions",
    {
      mode: "payment",
      customer_email: c.email,
      line_items: { 0: { quantity: 1, price_data: { currency: f.pay_currency ?? "usd", unit_amount: f.pay_cents, product_data: { name: f.pay_desc || "Invoice" } } } },
      metadata: { client_file_id: f.id },
      success_url: `${back}${join}paid=${f.id}&session={CHECKOUT_SESSION_ID}`,
      cancel_url: back,
    },
    "POST",
    pay.accountId,
  );
  update("client_files", f.id, { pay_session: session.id });
  return session.url;
}

export async function confirmPay(c: ClientRow, fileId: string, sessionId: string) {
  const f = get<FileRow>("SELECT * FROM client_files WHERE id = ? AND client_id = ?", fileId, c.id);
  if (!f || f.paid_at) return Boolean(f?.paid_at);
  if (!f.pay_session || f.pay_session !== sessionId) return false;
  const pay = workspacePayments(c.workspace_id);
  if (!pay.accountId) return false;
  const s = await stripe<{ payment_status: string; amount_total: number; currency: string }>(`/checkout/sessions/${encodeURIComponent(sessionId)}`, {}, "GET", pay.accountId);
  if (s.payment_status !== "paid") return false;
  update("client_files", f.id, { paid_at: now() });
  logActivity({ workspaceId: c.workspace_id, actorLabel: c.name, action: "client_paid", documentId: f.document_id, meta: { name: c.name, amount: formatMoney(s.amount_total, s.currency) } });
  notify({ userId: c.assigned_to ?? c.created_by, workspaceId: c.workspace_id, title: `${c.name} paid ${formatMoney(s.amount_total, s.currency)}`, link: `/app/${c.workspace_id}/clients/${c.id}?tab=documents` });
  return true;
}

export { ensureSlug };
