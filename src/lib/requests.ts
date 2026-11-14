import "server-only";
import crypto from "node:crypto";
import { all, get, insert, run, tx, update } from "./db";
import { id, now, sha256, token } from "./ids";
import { HttpError, badRequest, notFound } from "./http";
import { appUrl, mailConfigured, sendMail } from "./mail";
import { logActivity, notify } from "./activity";
import { createDocument, readCurrentPdf, getDocument } from "./documents";
import { mergePdfs, normalizeToPdf } from "./pdf";
import { ACCEPT_EXT, ACCEPT_LABEL, type Accept } from "./request-templates";
import type { Ctx } from "./auth";

/**
 * Secure document requests: ask someone for a checklist of files through a private upload link.
 *
 * Security, in layers:
 *  - The link itself is a long random token, and it expires (30 days by default).
 *  - Optionally the recipient must prove who they are first: a one-time code emailed to the
 *    address the request was sent to, or an access code the sender shares another way (by phone,
 *    text). Codes are stored only as hashes; five wrong tries lock the link for 15 minutes.
 *  - Until verified, the link shows only who is asking, never the checklist or the message.
 *  - Every step (opened, verified, failed code, uploaded, returned, submitted) goes in an audit
 *    trail with the time and IP address.
 *  - Uploads land in the sender's private workspace, converted to PDF.
 */

export type RequestRow = {
  id: string;
  workspace_id: string;
  title: string;
  message: string;
  recipient_name: string;
  recipient_email: string;
  due_date: string | null;
  token: string;
  status: string;
  document_id: string | null;
  created_by: string;
  created_at: number;
  viewed_at: number | null;
  completed_at: number | null;
  last_reminded_at: number | null;
  verify: "none" | "email" | "code";
  access_code_hash: string | null;
  otp_hash: string | null;
  otp_expires_at: number | null;
  otp_sent_at: number | null;
  failed_attempts: number;
  locked_until: number | null;
  expires_at: number | null;
  auto_remind: number;
  reminders_sent: number;
  packet: number;
  packet_document_id: string | null;
};

export type ItemRow = {
  id: string;
  request_id: string;
  position: number;
  label: string;
  note: string;
  required: number;
  accept: Accept;
  status: "needed" | "uploaded" | "returned";
  document_id: string | null;
  file_names: string;
  feedback: string | null;
  uploaded_at: number | null;
};

const DAY = 86_400_000;
const OTP_TTL = 10 * 60_000;
const SESSION_TTL = 12 * 3600_000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;

// ---------- helpers ----------

export const requestLink = (t: string) => appUrl(`/request/${t}`);

/** Status as people see it: an open request past its expiry date is "expired". */
export function statusOf(r: RequestRow) {
  if (r.status !== "complete" && r.status !== "cancelled" && r.expires_at && r.expires_at < now()) return "expired";
  return r.status;
}

const isOpen = (r: RequestRow) => ["pending", "viewed", "in_progress"].includes(statusOf(r));

export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

const codeHash = (requestId: string, code: string) => sha256(`${requestId}:${code.replace(/[\s-]/g, "").toUpperCase()}`);
const sameHash = (a: string | null, b: string) => Boolean(a) && a!.length === b.length && crypto.timingSafeEqual(Buffer.from(a!), Buffer.from(b));

/** An access code people can read out over the phone: no 0/O or 1/I mix-ups. */
function newAccessCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = Array.from({ length: 8 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function logEvent(requestId: string, kind: string, detail = "", ip?: string | null) {
  insert("doc_request_events", { id: id("rqe_"), request_id: requestId, kind, detail, ip: ip ?? null, created_at: now() });
}

export function items(requestId: string) {
  return all<ItemRow>("SELECT * FROM doc_request_items WHERE request_id = ? ORDER BY position", requestId);
}

export function itemView(i: ItemRow) {
  return {
    id: i.id,
    label: i.label,
    note: i.note,
    required: Boolean(i.required),
    accept: i.accept,
    acceptLabel: ACCEPT_LABEL[i.accept] ?? ACCEPT_LABEL.any,
    status: i.status,
    files: i.file_names ? i.file_names.split("\n") : [],
    feedback: i.feedback,
    uploadedAt: i.uploaded_at,
    documentId: i.document_id,
  };
}

function requester(r: RequestRow) {
  return get<{ name: string; email: string; workspace_name: string }>(
    "SELECT u.name, u.email, w.name AS workspace_name FROM users u, workspaces w WHERE u.id = ? AND w.id = ?",
    r.created_by,
    r.workspace_id,
  )!;
}

// ---------- creating ----------

export type NewRequest = {
  title: string;
  message: string;
  recipientName: string;
  recipientEmail: string;
  dueDate?: string | null;
  items: { label: string; note?: string; required?: boolean; accept?: Accept }[];
  verify: "none" | "email" | "code";
  expiresInDays: number;
  autoRemind: boolean;
  packet: boolean;
};

export async function createRequest(ctx: Ctx, input: NewRequest) {
  if (input.verify === "email" && !mailConfigured()) {
    throw badRequest("Email codes need email sending, which isn't set up on this server. Use an access code instead.");
  }
  const t = token();
  const rid = id("req_");
  const accessCode = input.verify === "code" ? newAccessCode() : null;
  const list = input.items.length ? input.items : [{ label: input.title }];
  tx(() => {
    insert("doc_requests", {
      id: rid,
      workspace_id: ctx.workspace.id,
      title: input.title,
      message: input.message,
      recipient_name: input.recipientName,
      recipient_email: input.recipientEmail,
      due_date: input.dueDate ?? null,
      token: t,
      status: "pending",
      created_by: ctx.user.id,
      created_at: now(),
      verify: input.verify,
      access_code_hash: accessCode ? codeHash(rid, accessCode) : null,
      expires_at: now() + input.expiresInDays * DAY,
      auto_remind: input.autoRemind ? 1 : 0,
      packet: input.packet ? 1 : 0,
    });
    list.forEach((it, i) =>
      insert("doc_request_items", {
        id: id("itm_"),
        request_id: rid,
        position: i,
        label: it.label,
        note: it.note ?? "",
        required: it.required === false ? 0 : 1,
        accept: it.accept ?? "any",
      }),
    );
    logEvent(rid, "created", `${list.length} item${list.length === 1 ? "" : "s"} · ${input.verify === "none" ? "link only" : input.verify === "email" ? "email code required" : "access code required"}`);
  });
  const r = get<RequestRow>("SELECT * FROM doc_requests WHERE id = ?", rid)!;
  const { delivered, error } = await emailRecipient(r, "new");
  logEvent(rid, delivered ? "emailed" : "email_failed", delivered ? input.recipientEmail : (error ?? ""));
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "requested_document", meta: { title: input.title, from: input.recipientName } });
  return { id: rid, link: requestLink(t), delivered, mailError: delivered ? null : (error ?? null), accessCode };
}

async function emailRecipient(r: RequestRow, kind: "new" | "remind" | "returned", extra?: string) {
  const who = requester(r);
  const list = items(r.id);
  const needed = list.filter((i) => i.status !== "uploaded");
  const subject =
    kind === "new" ? `${who.name} (${who.workspace_name}) requested: ${r.title}` : kind === "remind" ? `Reminder: ${r.title}` : `Please re-upload: ${r.title}`;
  const heading = kind === "new" ? `${who.name} requested documents` : kind === "remind" ? `A reminder from ${who.name}` : `${who.name} needs a new copy`;
  const paragraphs = [
    kind === "new"
      ? `Hi ${r.recipient_name}, ${who.name} at ${who.workspace_name} asked you to upload: ${r.title}.`
      : kind === "remind"
        ? `Hi ${r.recipient_name}, this is a reminder to upload: ${r.title}.`
        : `Hi ${r.recipient_name}, ${who.name} asked you to upload a new copy of: ${extra}.`,
    ...(kind === "new" && r.message ? [r.message] : []),
    ...(needed.length && kind !== "returned" ? [`Still needed: ${needed.map((i) => i.label).join(", ")}.`] : []),
    ...(r.due_date ? [`Due by ${r.due_date}.`] : []),
    ...(r.verify === "email" ? ["For your security, we'll email you a one-time code when you open the link."] : []),
    ...(r.verify === "code" ? [`For your security, you'll need the access code ${who.name} gives you separately.`] : []),
  ];
  return sendMail({
    to: r.recipient_email,
    subject,
    heading,
    paragraphs,
    cta: { label: "Upload securely", url: requestLink(r.token) },
    replyTo: who.email,
    footer: `Sent by pdftek for ${who.name}. Files you upload go privately to ${who.workspace_name}, no one else.`,
  });
}

// ---------- recipient side ----------

export function loadByToken(t: string) {
  const r = get<RequestRow>("SELECT * FROM doc_requests WHERE token = ?", t);
  if (!r) throw notFound("This request link is invalid.");
  return r;
}

export const sessionCookie = (t: string) => `pdftek-rq-${sha256(t).slice(0, 16)}`;

export function hasSession(r: RequestRow, raw: string | undefined) {
  if (r.verify === "none") return true;
  if (!raw) return false;
  const s = get<{ request_id: string; expires_at: number }>("SELECT request_id, expires_at FROM doc_request_sessions WHERE id = ?", sha256(raw));
  return Boolean(s && s.request_id === r.id && s.expires_at > now());
}

function startSession(r: RequestRow) {
  const raw = token(32);
  run("DELETE FROM doc_request_sessions WHERE expires_at < ?", now());
  insert("doc_request_sessions", { id: sha256(raw), request_id: r.id, expires_at: now() + SESSION_TTL });
  return { raw, maxAge: SESSION_TTL / 1000 };
}

function assertUsable(r: RequestRow) {
  const s = statusOf(r);
  if (s === "cancelled") throw new HttpError(410, "This request was cancelled.");
  if (s === "expired") throw new HttpError(410, "This link has expired. Ask the sender for a new one.");
}

/** What the upload page shows. Before verification: only who is asking. */
export function publicView(r: RequestRow, verified: boolean) {
  const who = requester(r);
  if (!r.viewed_at && verified) {
    run("UPDATE doc_requests SET viewed_at = ?, status = CASE WHEN status = 'pending' THEN 'viewed' ELSE status END WHERE id = ?", now(), r.id);
  }
  const base = {
    title: r.title,
    requester: who.name,
    workspaceName: who.workspace_name,
    recipientName: r.recipient_name,
    status: statusOf(r) === "pending" ? "viewed" : statusOf(r),
    verify: r.verify,
    emailHint: maskEmail(r.recipient_email),
    expiresAt: r.expires_at,
    locked: !verified,
    lockedUntil: r.locked_until && r.locked_until > now() ? r.locked_until : null,
  };
  if (!verified) return base;
  return { ...base, message: r.message, dueDate: r.due_date, items: items(r.id).map(itemView).map(({ documentId: _d, ...i }) => i) };
}

export async function sendOtp(r: RequestRow, ip: string) {
  assertUsable(r);
  if (r.verify !== "email") throw badRequest("This request doesn't use email codes.");
  if (r.otp_sent_at && now() - r.otp_sent_at < 45_000) throw new HttpError(429, "A code was just sent. Check your inbox (and spam folder), or try again in a minute.");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  update("doc_requests", r.id, { otp_hash: codeHash(r.id, code), otp_expires_at: now() + OTP_TTL, otp_sent_at: now() });
  const who = requester(r);
  const { delivered, error } = await sendMail({
    to: r.recipient_email,
    subject: `${code} is your pdftek verification code`,
    heading: `Your code: ${code}`,
    paragraphs: [
      `Enter this code to open the document request from ${who.name} (${who.workspace_name}). It expires in 10 minutes.`,
      "If you didn't try to open this request, you can ignore this email.",
    ],
  });
  if (!delivered) {
    logEvent(r.id, "email_failed", `verification code: ${error ?? ""}`, ip);
    throw new HttpError(503, "We couldn't send the code right now. Please try again in a few minutes.");
  }
  logEvent(r.id, "code_sent", maskEmail(r.recipient_email), ip);
}

/** Checks an email code or access code. Returns a session to set as a cookie. */
export function verifyCode(r: RequestRow, code: string, ip: string) {
  assertUsable(r);
  if (r.locked_until && r.locked_until > now()) {
    throw new HttpError(429, `Too many wrong codes. Try again after ${new Date(r.locked_until).toUTCString().slice(17, 22)} UTC.`);
  }
  const h = codeHash(r.id, code);
  const ok =
    r.verify === "email" ? sameHash(r.otp_hash, h) && (r.otp_expires_at ?? 0) > now() : r.verify === "code" ? sameHash(r.access_code_hash, h) : true;
  if (!ok) {
    const attempts = r.failed_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      update("doc_requests", r.id, { failed_attempts: 0, locked_until: now() + LOCK_MS, otp_hash: null });
      logEvent(r.id, "locked", `${MAX_ATTEMPTS} wrong codes`, ip);
      notify({ userId: r.created_by, workspaceId: r.workspace_id, title: `Request locked: ${r.title}`, body: "Someone entered the wrong code 5 times. The link is locked for 15 minutes." });
      throw new HttpError(429, "Too many wrong codes. The link is locked for 15 minutes.");
    }
    update("doc_requests", r.id, { failed_attempts: attempts });
    logEvent(r.id, "verify_failed", "", ip);
    const expired = r.verify === "email" && r.otp_hash && (r.otp_expires_at ?? 0) <= now();
    throw badRequest(expired ? "That code has expired. Send a new one." : `That code isn't right. ${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"} left.`);
  }
  update("doc_requests", r.id, { failed_attempts: 0, otp_hash: null, locked_until: null });
  logEvent(r.id, "verified", r.verify === "email" ? "email code" : "access code", ip);
  return startSession(r);
}

const NEEDS: Record<Accept, string> = { any: "a file", pdf: "a PDF", image: "a photo or scan (JPG, PNG, TIFF, HEIC or PDF)", office: "a Word, Excel or PDF file" };
const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();

/** Uploads files for one checklist item. Several files are combined into one PDF. */
export async function uploadItem(r: RequestRow, itemId: string, files: File[], ip: string) {
  assertUsable(r);
  const item = get<ItemRow>("SELECT * FROM doc_request_items WHERE id = ? AND request_id = ?", itemId, r.id);
  if (!item) throw notFound("That checklist item doesn't exist.");
  if (!files.length) throw badRequest("Choose a file to upload.");
  if (files.length > 10) throw badRequest("Upload up to 10 files per item.");
  const allowed = ACCEPT_EXT[item.accept];
  const pdfs: Buffer[] = [];
  for (const f of files) {
    if (f.size > 60 * 1024 * 1024) throw badRequest(`${f.name} is larger than 60 MB.`);
    if (allowed && !allowed.includes(extOf(f.name))) throw badRequest(`${f.name}: this item needs ${NEEDS[item.accept]}.`);
    pdfs.push((await normalizeToPdf(f.name, Buffer.from(await f.arrayBuffer()))).pdf);
  }
  const pdf = pdfs.length === 1 ? pdfs[0] : await mergePdfs(pdfs);
  const doc = await createDocument({
    workspaceId: r.workspace_id,
    userId: r.created_by,
    name: `${item.label} — ${r.recipient_name}.pdf`,
    data: pdf,
    tags: ["requested"],
    actorLabel: `${r.recipient_name} (via request)`,
  });
  const names = files.map((f) => f.name);
  update("doc_request_items", item.id, { status: "uploaded", document_id: doc.id, file_names: names.join("\n"), uploaded_at: now(), feedback: null });
  if (r.status === "pending" || r.status === "viewed") update("doc_requests", r.id, { status: "in_progress" });
  logEvent(r.id, "uploaded", `${item.label}: ${names.join(", ")}`, ip);
  return itemView({ ...item, status: "uploaded", document_id: doc.id, file_names: names.join("\n"), uploaded_at: now(), feedback: null });
}

/** The recipient says they're done: needs every required item. */
export async function submit(r: RequestRow, ip: string) {
  assertUsable(r);
  if (r.status === "complete") return;
  const list = items(r.id);
  const missing = list.filter((i) => i.required && i.status !== "uploaded");
  if (missing.length) throw badRequest(`Still needed: ${missing.map((i) => i.label).join(", ")}.`);
  const uploaded = list.filter((i) => i.status === "uploaded" && i.document_id);
  let packetId: string | null = null;
  if (r.packet && uploaded.length > 1) {
    try {
      const ctx = { workspace: { id: r.workspace_id } } as Ctx;
      const parts = await Promise.all(uploaded.map(async (i) => new Uint8Array(await readCurrentPdf(getDocument(ctx, i.document_id!)))));
      const packet = await createDocument({
        workspaceId: r.workspace_id,
        userId: r.created_by,
        name: `${r.title} — ${r.recipient_name} (complete packet).pdf`,
        data: await mergePdfs(parts),
        tags: ["requested", "packet"],
        actorLabel: `${r.recipient_name} (via request)`,
      });
      packetId = packet.id;
    } catch (err) {
      console.error("[pdftek] request packet failed", err);
    }
  }
  const firstId = packetId ?? uploaded[0]?.document_id ?? null;
  update("doc_requests", r.id, { status: "complete", completed_at: now(), document_id: firstId, packet_document_id: packetId });
  logEvent(r.id, "submitted", `${uploaded.length} item${uploaded.length === 1 ? "" : "s"}${packetId ? " · combined packet created" : ""}`, ip);
  logActivity({ workspaceId: r.workspace_id, actorLabel: r.recipient_name, action: "fulfilled_request", documentId: firstId, meta: { title: r.title } });
  notify({ userId: r.created_by, workspaceId: r.workspace_id, title: `${r.recipient_name} sent ${r.title}`, link: `/app/${r.workspace_id}/requests?id=${r.id}` });
  const who = requester(r);
  void sendMail({
    to: who.email,
    subject: `${r.recipient_name} sent: ${r.title}`,
    heading: `${r.recipient_name} completed your request`,
    paragraphs: [
      `${r.recipient_name} uploaded ${uploaded.length} of ${list.length} item${list.length === 1 ? "" : "s"} for "${r.title}":`,
      uploaded.map((i) => `✓ ${i.label}`).join("  ·  "),
      ...(packetId ? ["Everything is also combined into one PDF packet in your library."] : []),
    ],
    cta: { label: "Review the documents", url: appUrl(`/app/${r.workspace_id}/requests?id=${r.id}`) },
  });
  import("./automations")
    .then((m) => m.onEvent("request_completed", { workspaceId: r.workspace_id, documentId: firstId ?? undefined, headline: `${r.recipient_name} uploaded ${r.title}` }))
    .catch((e) => console.error(e));
}

// ---------- sender side ----------

export function requestSummary(r: RequestRow) {
  const list = items(r.id);
  return {
    id: r.id,
    title: r.title,
    message: r.message,
    recipientName: r.recipient_name,
    recipientEmail: r.recipient_email,
    dueDate: r.due_date,
    status: statusOf(r),
    documentId: r.document_id,
    packetDocumentId: r.packet_document_id,
    createdAt: r.created_at,
    viewedAt: r.viewed_at,
    completedAt: r.completed_at,
    expiresAt: r.expires_at,
    verify: r.verify,
    autoRemind: Boolean(r.auto_remind),
    packet: Boolean(r.packet),
    received: list.filter((i) => i.status === "uploaded").length,
    total: list.length,
    link: requestLink(r.token),
  };
}

export function requestDetail(r: RequestRow) {
  return {
    ...requestSummary(r),
    items: items(r.id).map(itemView),
    events: all<{ kind: string; detail: string; ip: string | null; created_at: number }>(
      "SELECT kind, detail, ip, created_at FROM doc_request_events WHERE request_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200",
      r.id,
    ).map((e) => ({ kind: e.kind, detail: e.detail, ip: e.ip, createdAt: e.created_at })),
  };
}

export async function remind(r: RequestRow, auto = false) {
  if (!isOpen(r)) throw badRequest("This request is already closed.");
  const { delivered, error } = await emailRecipient(r, "remind");
  run("UPDATE doc_requests SET last_reminded_at = ?, reminders_sent = reminders_sent + ? WHERE id = ?", now(), auto ? 1 : 0, r.id);
  logEvent(r.id, delivered ? "reminded" : "email_failed", delivered ? (auto ? "automatic reminder" : "reminder emailed") : `reminder: ${error ?? ""}`);
  return { delivered, mailError: delivered ? null : (error ?? null) };
}

/** Sends one item back with a note ("this statement is from last year"). */
export async function returnItem(r: RequestRow, itemId: string, feedback: string) {
  if (statusOf(r) === "cancelled" || statusOf(r) === "expired") throw badRequest("This request is closed. Extend it first.");
  const item = get<ItemRow>("SELECT * FROM doc_request_items WHERE id = ? AND request_id = ?", itemId, r.id);
  if (!item) throw notFound();
  update("doc_request_items", item.id, { status: "returned", feedback });
  update("doc_requests", r.id, { status: "in_progress", completed_at: null });
  logEvent(r.id, "returned", `${item.label}: ${feedback}`);
  const { delivered, error } = await emailRecipient(r, "returned", `${item.label} (${feedback})`);
  if (!delivered) logEvent(r.id, "email_failed", `re-upload request: ${error ?? ""}`);
  return { delivered, mailError: delivered ? null : (error ?? null) };
}

export function extend(r: RequestRow, days: number) {
  const base = Math.max(now(), r.expires_at ?? now());
  update("doc_requests", r.id, { expires_at: base + days * DAY, status: r.status === "cancelled" ? "in_progress" : r.status });
  logEvent(r.id, "extended", `${days} days`);
}

export function rotateAccessCode(r: RequestRow) {
  if (r.verify !== "code") throw badRequest("This request doesn't use an access code.");
  const code = newAccessCode();
  update("doc_requests", r.id, { access_code_hash: codeHash(r.id, code), failed_attempts: 0, locked_until: null });
  run("DELETE FROM doc_request_sessions WHERE request_id = ?", r.id);
  logEvent(r.id, "code_changed", "new access code; earlier sessions signed out");
  return code;
}

// ---------- automatic reminders ----------

let lastReminderRun = 0;

/**
 * Runs from the scheduler. With a due date: 2 days before, on the day, and 3 days late. Without
 * one: after 3, 7 and 14 days. Never more than once a day, and only while the request is open.
 */
export async function sendDueReminders() {
  if (now() - lastReminderRun < 3600_000 || !mailConfigured()) return;
  lastReminderRun = now();
  const open = all<RequestRow>(
    "SELECT * FROM doc_requests WHERE auto_remind = 1 AND reminders_sent < 3 AND status IN ('pending', 'viewed', 'in_progress') AND (expires_at IS NULL OR expires_at > ?)",
    now(),
  );
  for (const r of open) {
    const due = r.due_date ? Date.parse(`${r.due_date}T15:00:00Z`) : null;
    const schedule = due ? [due - 2 * DAY, due, due + 3 * DAY] : [r.created_at + 3 * DAY, r.created_at + 7 * DAY, r.created_at + 14 * DAY];
    const next = schedule[r.reminders_sent];
    if (next === undefined || now() < next || (r.last_reminded_at && now() - r.last_reminded_at < 20 * 3600_000)) continue;
    try {
      await remind(r, true);
    } catch (err) {
      console.error("[pdftek] request reminder failed", r.id, err);
    }
  }
}
