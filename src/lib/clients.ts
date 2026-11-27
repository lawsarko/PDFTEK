import "server-only";
import { all, get, insert, run, tx, update } from "./db";
import { id, now } from "./ids";
import { badRequest, notFound } from "./http";
import { appUrl, mailConfigured, sendMail } from "./mail";
import { logActivity, notify } from "./activity";
import { createDocument } from "./documents";
import { workspaceCanUseAi } from "./billing";
import { aiConfigured } from "./ai";
import { assertClientRoom, activeClientCount, brand, clientLimit, ensureSlug, firmDisplayName, firmOf, portalUrl } from "./firm";
import { createRequest, items, logEvent, requestLink, requestSummary, statusOf, type ItemRow, type NewRequest, type RequestRow } from "./requests";
import { deadlines, seasonYear, stageLabel, type Stage } from "./client-shared";
import type { Ctx } from "./auth";

/**
 * Clients: the people and businesses a firm collects documents from. Each client can have a portal
 * account (sign-in by emailed code or link, see client-portal.ts), requests for each tax year,
 * messages with the firm, and the files exchanged both ways.
 */

export type ClientRow = {
  id: string;
  workspace_id: string;
  kind: "individual" | "couple" | "business";
  name: string;
  email: string;
  phone: string;
  spouse_name: string;
  spouse_email: string;
  company: string;
  tags: string;
  assigned_to: string | null;
  notes: string;
  invited_at: number | null;
  last_login_at: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

export type FileRow = {
  id: string;
  workspace_id: string;
  client_id: string;
  document_id: string;
  year: number | null;
  category: string;
  source: "client" | "firm";
  shared: number;
  ai_json: string | null;
  pay_cents: number | null;
  pay_currency: string | null;
  pay_desc: string | null;
  pay_session: string | null;
  paid_at: number | null;
  client_viewed_at: number | null;
  created_by: string | null;
  created_at: number;
};

const DAY = 86_400_000;
const tagsOf = (c: Pick<ClientRow, "tags">) => {
  try {
    return (JSON.parse(c.tags) as string[]).filter(Boolean);
  } catch {
    return [];
  }
};
const cleanTags = (t: string[] | undefined) => [...new Set((t ?? []).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 12);

export function getClient(workspaceId: string, clientId: string): ClientRow {
  const c = get<ClientRow>("SELECT * FROM clients WHERE id = ? AND workspace_id = ?", clientId, workspaceId);
  if (!c) throw notFound("Client not found.");
  return c;
}

function openRequests(clientId: string) {
  return all<RequestRow>("SELECT * FROM doc_requests WHERE client_id = ? AND status IN ('pending','viewed','in_progress') ORDER BY created_at DESC", clientId).filter(
    (r) => statusOf(r) !== "expired",
  );
}

/** Outstanding checklist items across a client's open requests. */
function outstanding(reqs: RequestRow[]) {
  return reqs.flatMap((r) => items(r.id).filter((i) => i.status !== "uploaded" && i.status !== "na").map((i) => ({ ...i, request: r })));
}

function engagement(clientId: string, year: number) {
  return get<{ id: string; status: Stage; service: string; due_date: string | null; updated_at: number }>(
    "SELECT id, status, service, due_date, updated_at FROM client_engagements WHERE client_id = ? AND year = ? ORDER BY created_at LIMIT 1",
    clientId,
    year,
  );
}

export function clientDTO(c: ClientRow, year = seasonYear()) {
  const reqs = openRequests(c.id);
  const out = outstanding(reqs);
  const today = new Date().toISOString().slice(0, 10);
  const flagged = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM doc_request_items i JOIN doc_requests r ON r.id = i.request_id WHERE r.client_id = ? AND i.ai_status = 'flagged' AND i.status = 'uploaded'`,
    c.id,
  )!.n;
  const last = get<{ t: number | null }>(
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(e.created_at) AS t FROM doc_request_events e JOIN doc_requests r ON r.id = e.request_id WHERE r.client_id = ?
       UNION ALL SELECT MAX(created_at) FROM client_messages WHERE client_id = ?
       UNION ALL SELECT MAX(created_at) FROM client_files WHERE client_id = ?)`,
    c.id,
    c.id,
    c.id,
  )?.t;
  const e = engagement(c.id, year);
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    email: c.email,
    phone: c.phone,
    spouseName: c.spouse_name,
    spouseEmail: c.spouse_email,
    company: c.company,
    tags: tagsOf(c),
    assignedTo: c.assigned_to,
    notes: c.notes,
    invitedAt: c.invited_at,
    lastLoginAt: c.last_login_at,
    createdAt: c.created_at,
    archived: Boolean(c.archived_at),
    openRequests: reqs.length,
    outstanding: out.length,
    overdue: reqs.filter((r) => r.due_date && r.due_date < today).length,
    flagged,
    lastActivityAt: last ?? c.created_at,
    lastRemindedAt: reqs.reduce<number | null>((m, r) => (r.last_reminded_at && (!m || r.last_reminded_at > m) ? r.last_reminded_at : m), null),
    stage: (e?.status ?? "not_started") as Stage,
    service: e?.service ?? "Tax return",
  };
}
export type ClientDTO = ReturnType<typeof clientDTO>;

export function listClients(workspaceId: string, opts: { archived?: boolean; year?: number } = {}) {
  const rows = all<ClientRow>(
    `SELECT * FROM clients WHERE workspace_id = ? AND archived_at IS ${opts.archived ? "NOT NULL" : "NULL"} ORDER BY name COLLATE NOCASE`,
    workspaceId,
  );
  return rows.map((c) => clientDTO(c, opts.year));
}

// ---------- creating and editing ----------

export type ClientInput = {
  kind?: ClientRow["kind"];
  name: string;
  email: string;
  phone?: string;
  spouseName?: string;
  spouseEmail?: string;
  company?: string;
  tags?: string[];
  assignedTo?: string | null;
  notes?: string;
};

function assertAssignee(workspaceId: string, userId: string | null | undefined) {
  if (userId && !get("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?", workspaceId, userId)) throw badRequest("Assign the client to someone in your workspace.");
}

function row(ctx: Ctx, input: ClientInput) {
  return {
    kind: input.kind ?? "individual",
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: (input.phone ?? "").trim(),
    spouse_name: (input.spouseName ?? "").trim(),
    spouse_email: (input.spouseEmail ?? "").trim().toLowerCase(),
    company: (input.company ?? "").trim(),
    tags: JSON.stringify(cleanTags(input.tags)),
    assigned_to: input.assignedTo ?? ctx.user.id,
    notes: (input.notes ?? "").slice(0, 4000),
  };
}

export function createClient(ctx: Ctx, input: ClientInput) {
  assertClientRoom(ctx);
  assertAssignee(ctx.workspace.id, input.assignedTo);
  const data = row(ctx, input);
  if (get("SELECT 1 FROM clients WHERE workspace_id = ? AND email = ? AND archived_at IS NULL", ctx.workspace.id, data.email)) {
    throw badRequest(`A client with ${data.email} already exists.`);
  }
  ensureSlug(ctx.workspace.id);
  const cid = id("cli_");
  const t = now();
  tx(() => {
    insert("clients", { id: cid, workspace_id: ctx.workspace.id, ...data, created_by: ctx.user.id, created_at: t, updated_at: t });
    insert("client_engagements", { id: id("eng_"), workspace_id: ctx.workspace.id, client_id: cid, year: seasonYear(), service: "Tax return", status: "not_started", created_at: t, updated_at: t });
  });
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client_added", meta: { name: data.name } });
  return getClient(ctx.workspace.id, cid);
}

/** Adds many clients at once (from a spreadsheet). Skips rows whose email is already a client. */
export function importClients(ctx: Ctx, list: ClientInput[]) {
  const existing = new Set(all<{ email: string }>("SELECT email FROM clients WHERE workspace_id = ? AND archived_at IS NULL", ctx.workspace.id).map((r) => r.email));
  const fresh: ClientInput[] = [];
  const skipped: string[] = [];
  for (const c of list) {
    const email = c.email.trim().toLowerCase();
    if (existing.has(email)) skipped.push(email);
    else {
      existing.add(email);
      fresh.push(c);
    }
  }
  assertClientRoom(ctx, fresh.length);
  ensureSlug(ctx.workspace.id);
  const t = now();
  tx(() => {
    for (const c of fresh) {
      const cid = id("cli_");
      insert("clients", { id: cid, workspace_id: ctx.workspace.id, ...row(ctx, c), assigned_to: ctx.user.id, created_by: ctx.user.id, created_at: t, updated_at: t });
      insert("client_engagements", { id: id("eng_"), workspace_id: ctx.workspace.id, client_id: cid, year: seasonYear(), service: "Tax return", status: "not_started", created_at: t, updated_at: t });
    }
  });
  if (fresh.length) logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "clients_imported", meta: { count: fresh.length } });
  return { added: fresh.length, skipped };
}

export function updateClient(ctx: Ctx, clientId: string, input: Partial<ClientInput>) {
  const c = getClient(ctx.workspace.id, clientId);
  if (input.assignedTo !== undefined) assertAssignee(ctx.workspace.id, input.assignedTo);
  const merged = row(ctx, { ...{ kind: c.kind, name: c.name, email: c.email, phone: c.phone, spouseName: c.spouse_name, spouseEmail: c.spouse_email, company: c.company, tags: tagsOf(c), assignedTo: c.assigned_to, notes: c.notes }, ...input });
  if (merged.email !== c.email && get("SELECT 1 FROM clients WHERE workspace_id = ? AND email = ? AND id != ? AND archived_at IS NULL", ctx.workspace.id, merged.email, c.id)) {
    throw badRequest(`Another client already uses ${merged.email}.`);
  }
  update("clients", c.id, { ...merged, updated_at: now() });
  if (merged.email !== c.email) run("DELETE FROM client_sessions WHERE client_id = ?", c.id);
  return getClient(ctx.workspace.id, c.id);
}

export function archiveClient(ctx: Ctx, clientId: string, archived: boolean) {
  const c = getClient(ctx.workspace.id, clientId);
  if (!archived && c.archived_at) assertClientRoom(ctx);
  update("clients", c.id, { archived_at: archived ? now() : null, updated_at: now() });
  if (archived) run("DELETE FROM client_sessions WHERE client_id = ?", c.id);
}

export function setStage(ctx: Ctx, clientId: string, year: number, status: Stage, service = "Tax return", dueDate?: string | null) {
  const c = getClient(ctx.workspace.id, clientId);
  const e = get<{ id: string; status: string }>("SELECT id, status FROM client_engagements WHERE client_id = ? AND year = ? AND service = ?", c.id, year, service);
  if (e) update("client_engagements", e.id, { status, updated_at: now(), ...(dueDate !== undefined ? { due_date: dueDate } : {}) });
  else insert("client_engagements", { id: id("eng_"), workspace_id: ctx.workspace.id, client_id: c.id, year, service, status, due_date: dueDate ?? null, created_at: now(), updated_at: now() });
  if (e?.status !== status) logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client_stage", meta: { name: c.name, stage: stageLabel(status), year } });
}

/** A client's requests all came in: move "Waiting on client" to "Documents in". */
export function onRequestComplete(r: RequestRow) {
  if (!r.client_id) return;
  const year = r.year ?? seasonYear();
  if (openRequests(r.client_id).length) return;
  run("UPDATE client_engagements SET status = 'docs_in', updated_at = ? WHERE client_id = ? AND year = ? AND status IN ('not_started','waiting')", now(), r.client_id, year);
}

// ---------- requests for a client ----------

export async function requestForClient(ctx: Ctx, clientId: string, input: Omit<NewRequest, "recipientName" | "recipientEmail" | "clientId"> & { year?: number | null }) {
  const c = getClient(ctx.workspace.id, clientId);
  if (c.archived_at) throw badRequest("This client is archived. Restore them first.");
  const year = input.year ?? seasonYear();
  // Without email sending, codes can't be emailed: the link alone opens it (the portal has its own sign-in).
  const verify = input.verify === "email" && !mailConfigured() ? "none" : input.verify;
  const out = await createRequest(ctx, { ...input, verify, recipientName: c.name, recipientEmail: c.email, clientId: c.id, year });
  run("UPDATE client_engagements SET status = 'waiting', updated_at = ? WHERE client_id = ? AND year = ? AND status IN ('not_started','docs_in')", now(), c.id, year);
  if (!get("SELECT 1 FROM client_engagements WHERE client_id = ? AND year = ?", c.id, year)) {
    insert("client_engagements", { id: id("eng_"), workspace_id: ctx.workspace.id, client_id: c.id, year, service: "Tax return", status: "waiting", created_at: now(), updated_at: now() });
  }
  return out;
}

/** The same checklist to many clients (by selection or tag). Each gets their own private request. */
export async function bulkRequest(ctx: Ctx, clientIds: string[], input: Omit<NewRequest, "recipientName" | "recipientEmail" | "clientId"> & { year?: number | null }) {
  const ids = [...new Set(clientIds)].slice(0, 500);
  let sent = 0;
  let failed = 0;
  for (const cid of ids) {
    const c = get<ClientRow>("SELECT * FROM clients WHERE id = ? AND workspace_id = ? AND archived_at IS NULL", cid, ctx.workspace.id);
    if (!c) continue;
    const r = await requestForClient(ctx, c.id, input);
    if (r.delivered) sent++;
    else failed++;
  }
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "bulk_request", meta: { title: input.title, count: sent + failed } });
  return { sent, failed };
}

// ---------- recurring requests ----------

export type ScheduleSpec = Omit<NewRequest, "recipientName" | "recipientEmail" | "clientId">;

function nextRun(every: "month" | "quarter" | "year", from: number) {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + (every === "month" ? 1 : every === "quarter" ? 3 : 12));
  return d.getTime();
}

export function createSchedule(ctx: Ctx, clientId: string, every: "month" | "quarter" | "year", startAt: number, spec: ScheduleSpec) {
  const c = getClient(ctx.workspace.id, clientId);
  const sid = id("sch_");
  insert("request_schedules", { id: sid, workspace_id: ctx.workspace.id, client_id: c.id, every, spec_json: JSON.stringify(spec), next_run_at: Math.max(startAt, now()), active: 1, created_by: ctx.user.id, created_at: now() });
  return sid;
}

export function schedulesFor(clientId: string) {
  return all<{ id: string; every: string; spec_json: string; next_run_at: number; last_run_at: number | null; active: number }>(
    "SELECT id, every, spec_json, next_run_at, last_run_at, active FROM request_schedules WHERE client_id = ? ORDER BY created_at",
    clientId,
  ).map((s) => ({ id: s.id, every: s.every, title: (JSON.parse(s.spec_json) as ScheduleSpec).title, nextRunAt: s.next_run_at, lastRunAt: s.last_run_at, active: Boolean(s.active) }));
}

export function stopSchedule(workspaceId: string, scheduleId: string) {
  run("DELETE FROM request_schedules WHERE id = ? AND workspace_id = ?", scheduleId, workspaceId);
}

let lastScheduleRun = 0;
/** From the scheduler: sends recurring requests that are due. */
export async function runSchedules() {
  if (now() - lastScheduleRun < 10 * 60_000) return;
  lastScheduleRun = now();
  const due = all<{ id: string; workspace_id: string; client_id: string; every: "month" | "quarter" | "year"; spec_json: string; next_run_at: number; created_by: string }>(
    "SELECT * FROM request_schedules WHERE active = 1 AND next_run_at <= ?",
    now(),
  );
  for (const s of due) {
    // Move the schedule on first, so a failure can't send the same request twice.
    run("UPDATE request_schedules SET next_run_at = ?, last_run_at = ? WHERE id = ?", nextRun(s.every, s.next_run_at), now(), s.id);
    try {
      const ws = get<import("./auth").Workspace>("SELECT * FROM workspaces WHERE id = ?", s.workspace_id);
      const user = get<{ id: string; email: string; name: string; created_at: number }>("SELECT id, email, name, created_at FROM users WHERE id = ?", s.created_by);
      const c = get<ClientRow>("SELECT * FROM clients WHERE id = ? AND archived_at IS NULL", s.client_id);
      if (!ws || !user || !c) continue;
      const { effectivePlan } = await import("./auth");
      const ctx: Ctx = { user: { ...user, is_guest: false, email_verified: true }, workspace: ws, role: "owner", plan: effectivePlan(ws) };
      try {
        clientLimit(ctx);
      } catch {
        continue; // the firm's plan lapsed: pause quietly
      }
      const spec = JSON.parse(s.spec_json) as ScheduleSpec;
      const period = new Date(s.next_run_at).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      await requestForClient(ctx, c.id, { ...spec, title: `${spec.title} — ${period}`, year: new Date(s.next_run_at).getUTCFullYear() });
    } catch (err) {
      console.error("[pdftek] recurring request failed", s.id, err);
    }
  }
}

// ---------- retention ----------

let lastRetentionRun = 0;
/**
 * Firms that set a retention period (Firm settings) have client documents moved to the trash once
 * they're older than that: a 2019 return with 7 years' retention goes at the start of 2027.
 */
export async function runRetention() {
  if (now() - lastRetentionRun < 6 * 3600_000) return;
  lastRetentionRun = now();
  const firms = all<{ id: string; retention_years: number }>("SELECT id, retention_years FROM workspaces WHERE retention_years IS NOT NULL AND retention_years > 0");
  const thisYear = new Date().getUTCFullYear();
  for (const f of firms) {
    const cutoff = thisYear - f.retention_years - 1;
    const old = all<{ document_id: string }>(
      `SELECT f.document_id FROM client_files f JOIN documents d ON d.id = f.document_id WHERE f.workspace_id = ? AND f.year IS NOT NULL AND f.year <= ? AND d.deleted_at IS NULL`,
      f.id,
      cutoff,
    );
    for (const d of old) run("UPDATE documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", now(), d.document_id);
    if (old.length) logActivity({ workspaceId: f.id, actorLabel: "Retention policy", action: "retention_cleanup", meta: { count: old.length, through: cutoff } });
  }
}

// ---------- reminders ----------

/**
 * One email to a client listing everything still outstanding across their open requests (instead of
 * one email per request). `due` are the requests whose reminder schedule triggered (auto) or all.
 */
export async function remindClientDigest(clientId: string, dueIds?: string[], auto = false) {
  const c = get<ClientRow>("SELECT * FROM clients WHERE id = ?", clientId);
  if (!c || c.archived_at) return { delivered: false, mailError: "This client is archived." };
  const reqs = openRequests(c.id);
  const list = outstanding(reqs);
  if (!list.length) throw badRequest(`${c.name} has nothing outstanding.`);
  const f = firmOf(c.workspace_id);
  const firm = firmDisplayName(f);
  const url = portalUrl(ensureSlug(c.workspace_id));
  const dueSoon = reqs.map((r) => r.due_date).filter(Boolean).sort()[0];
  const lines = list.slice(0, 25).map((i) => `• ${i.label}${i.status === "returned" && i.feedback ? ` (please upload a new copy: ${i.feedback})` : ""}`);
  const { delivered, error } = await sendMail({
    to: c.email,
    subject: `Reminder from ${firm}: ${list.length} document${list.length === 1 ? "" : "s"} still needed`,
    heading: `${list.length} document${list.length === 1 ? "" : "s"} still needed`,
    paragraphs: [
      `Hi ${c.name.split(" ")[0]}, ${firm} is still waiting for:`,
      lines.join("\n") + (list.length > 25 ? `\n…and ${list.length - 25} more` : ""),
      ...(dueSoon ? [`Please upload by ${dueSoon}.`] : []),
      "If something doesn't apply to you this year, you can mark it that way in your portal.",
    ],
    cta: { label: "Upload securely", url },
    footer: `Sent by pdftek for ${firm}. Files you upload go privately to ${firm}.`,
  });
  const t = now();
  for (const r of reqs) {
    const counted = auto && (!dueIds || dueIds.includes(r.id));
    run("UPDATE doc_requests SET last_reminded_at = ?, reminders_sent = reminders_sent + ? WHERE id = ?", t, counted ? 1 : 0, r.id);
    logEvent(r.id, delivered ? "reminded" : "email_failed", delivered ? (auto ? "automatic reminder (combined)" : "reminder emailed (combined)") : `reminder: ${error ?? ""}`);
  }
  return { delivered, mailError: delivered ? null : (error ?? null) };
}

// ---------- files ----------

/** A client uploaded a file for a request: file it under them. Returns the AI check status to start. */
export function fileClientUpload(r: RequestRow, item: ItemRow, documentId: string): ItemRow["ai_status"] {
  if (!r.client_id) return null;
  run(
    `INSERT INTO client_files (id, workspace_id, client_id, document_id, year, category, source, shared, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'client', 0, ?) ON CONFLICT(client_id, document_id) DO NOTHING`,
    id("cf_"),
    r.workspace_id,
    r.client_id,
    documentId,
    r.year ?? seasonYear(),
    item.label.slice(0, 120),
    now(),
  );
  return aiConfigured() && workspaceCanUseAi(r.workspace_id) ? "checking" : "skipped";
}

export function fileDTO(f: FileRow & { name: string; page_count: number; size: number; deleted_at: number | null }) {
  const ai = f.ai_json ? (JSON.parse(f.ai_json) as { formType?: string; taxYear?: number | null; issuer?: string; summary?: string; amounts?: { label: string; amount: number }[] }) : null;
  return {
    id: f.id,
    documentId: f.document_id,
    name: f.name,
    pages: f.page_count,
    size: f.size,
    year: f.year,
    category: f.category,
    source: f.source,
    shared: Boolean(f.shared),
    ai,
    pay: f.pay_cents ? { cents: f.pay_cents, currency: f.pay_currency ?? "usd", description: f.pay_desc ?? "", paidAt: f.paid_at } : null,
    clientViewedAt: f.client_viewed_at,
    createdAt: f.created_at,
  };
}

export function clientFiles(clientId: string, opts: { forClient?: boolean } = {}) {
  return all<FileRow & { name: string; page_count: number; size: number; deleted_at: number | null }>(
    `SELECT f.*, d.name, d.page_count, d.size, d.deleted_at FROM client_files f JOIN documents d ON d.id = f.document_id
      WHERE f.client_id = ? AND d.deleted_at IS NULL ${opts.forClient ? "AND (f.source = 'client' OR f.shared = 1)" : ""}
      ORDER BY COALESCE(f.year, 0) DESC, f.created_at DESC`,
    clientId,
  ).map(fileDTO);
}

/** The firm shares a document with a client (a finished return, an engagement letter…). */
export async function shareFile(ctx: Ctx, clientId: string, file: { name: string; data: Buffer }, opts: { year?: number | null; category?: string; payCents?: number | null; payDescription?: string; notify?: boolean }) {
  const c = getClient(ctx.workspace.id, clientId);
  const doc = await createDocument({ workspaceId: ctx.workspace.id, userId: ctx.user.id, name: file.name, data: file.data, tags: ["client"] });
  return attachFile(ctx, c, doc.id, opts);
}

/** Puts an existing workspace document in a client's folder (optionally shared with them). */
export async function attachFile(ctx: Ctx, c: ClientRow, documentId: string, opts: { year?: number | null; category?: string; payCents?: number | null; payDescription?: string; notify?: boolean; shared?: boolean }) {
  const d = get<{ name: string }>("SELECT name FROM documents WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL", documentId, ctx.workspace.id);
  if (!d) throw notFound("Document not found.");
  const fid = id("cf_");
  const shared = opts.shared !== false;
  run(
    `INSERT INTO client_files (id, workspace_id, client_id, document_id, year, category, source, shared, pay_cents, pay_currency, pay_desc, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'firm', ?, ?, 'usd', ?, ?, ?)
     ON CONFLICT(client_id, document_id) DO UPDATE SET shared = excluded.shared, year = excluded.year, category = excluded.category, pay_cents = excluded.pay_cents, pay_desc = excluded.pay_desc`,
    fid,
    ctx.workspace.id,
    c.id,
    documentId,
    opts.year ?? seasonYear(),
    (opts.category ?? "").slice(0, 120),
    shared ? 1 : 0,
    opts.payCents ?? null,
    opts.payCents ? (opts.payDescription || d.name).slice(0, 200) : null,
    ctx.user.id,
    now(),
  );
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client_file_shared", documentId, meta: { name: c.name, file: d.name } });
  if (shared && opts.notify !== false && mailConfigured()) {
    const firm = firmDisplayName(firmOf(ctx.workspace.id));
    void sendMail({
      to: c.email,
      subject: `${firm} shared a document with you`,
      heading: "A new document is ready for you",
      paragraphs: [
        `Hi ${c.name.split(" ")[0]}, ${firm} shared "${d.name}" with you.`,
        ...(opts.payCents ? [`It can be downloaded once the invoice (${money(opts.payCents)}) is paid. You can pay securely in your portal.`] : []),
      ],
      cta: { label: "Open your portal", url: portalUrl(ensureSlug(ctx.workspace.id)) },
      footer: `Sent by pdftek for ${firm}.`,
    });
  }
  return get<{ id: string }>("SELECT id FROM client_files WHERE client_id = ? AND document_id = ?", c.id, documentId)!.id;
}

export function updateFile(ctx: Ctx, fileId: string, patch: { shared?: boolean; year?: number | null; category?: string; payCents?: number | null; payDescription?: string }) {
  const f = get<FileRow>("SELECT * FROM client_files WHERE id = ? AND workspace_id = ?", fileId, ctx.workspace.id);
  if (!f) throw notFound("File not found.");
  const next: Record<string, unknown> = {};
  if (patch.shared !== undefined) next.shared = patch.shared ? 1 : 0;
  if (patch.year !== undefined) next.year = patch.year;
  if (patch.category !== undefined) next.category = patch.category.slice(0, 120);
  if (patch.payCents !== undefined && !f.paid_at) {
    next.pay_cents = patch.payCents || null;
    next.pay_desc = patch.payCents ? (patch.payDescription ?? f.pay_desc ?? "Invoice").slice(0, 200) : null;
  }
  update("client_files", f.id, next);
}

export function removeFile(ctx: Ctx, fileId: string) {
  run("DELETE FROM client_files WHERE id = ? AND workspace_id = ?", fileId, ctx.workspace.id);
}

const money = (cents: number, currency = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

// ---------- messages ----------

export type MessageRow = { id: string; author: "firm" | "client"; author_name: string; author_id: string | null; body: string; internal: number; read_at: number | null; created_at: number };

export function messages(clientId: string, forClient = false) {
  return all<MessageRow>(
    `SELECT id, author, author_name, author_id, body, internal, read_at, created_at FROM client_messages WHERE client_id = ? ${forClient ? "AND internal = 0" : ""} ORDER BY created_at LIMIT 500`,
    clientId,
  ).map((m) => ({ id: m.id, author: m.author, authorName: m.author_name, body: m.body, internal: Boolean(m.internal), readAt: m.read_at, createdAt: m.created_at }));
}

export async function postFirmMessage(ctx: Ctx, clientId: string, body: string, internal: boolean) {
  const c = getClient(ctx.workspace.id, clientId);
  const text = body.trim().slice(0, 5000);
  if (!text) throw badRequest("Write a message first.");
  insert("client_messages", { id: id("msg_"), workspace_id: ctx.workspace.id, client_id: c.id, author: "firm", author_id: ctx.user.id, author_name: ctx.user.name, body: text, internal: internal ? 1 : 0, created_at: now() });
  // Messages from the client count as read once the firm replies.
  run("UPDATE client_messages SET read_at = ? WHERE client_id = ? AND author = 'client' AND read_at IS NULL", now(), c.id);
  if (!internal && mailConfigured()) {
    const firm = firmDisplayName(firmOf(ctx.workspace.id));
    void sendMail({
      to: c.email,
      subject: `New message from ${firm}`,
      heading: `${ctx.user.name} sent you a message`,
      paragraphs: [`Hi ${c.name.split(" ")[0]}, you have a new secure message from ${firm}. For your privacy, read and reply to it in your portal.`],
      cta: { label: "Read the message", url: portalUrl(ensureSlug(ctx.workspace.id), "?tab=messages") },
      footer: `Sent by pdftek for ${firm}.`,
    });
  }
}

export function postClientMessage(c: ClientRow, body: string) {
  const text = body.trim().slice(0, 5000);
  if (!text) throw badRequest("Write a message first.");
  insert("client_messages", { id: id("msg_"), workspace_id: c.workspace_id, client_id: c.id, author: "client", author_id: null, author_name: c.name, body: text, internal: 0, created_at: now() });
  run("UPDATE client_messages SET read_at = ? WHERE client_id = ? AND author = 'firm' AND read_at IS NULL", now(), c.id);
  const to = c.assigned_to ?? c.created_by;
  notify({ userId: to, workspaceId: c.workspace_id, title: `Message from ${c.name}`, body: text.slice(0, 140), link: `/app/${c.workspace_id}/clients/${c.id}?tab=messages` });
}

export function markClientMessagesRead(ctx: Ctx, clientId: string) {
  run("UPDATE client_messages SET read_at = ? WHERE client_id = ? AND workspace_id = ? AND author = 'client' AND read_at IS NULL", now(), clientId, ctx.workspace.id);
}

// ---------- the client's page ----------

export function clientDetail(ctx: Ctx, clientId: string) {
  const c = getClient(ctx.workspace.id, clientId);
  const reqs = all<RequestRow>("SELECT * FROM doc_requests WHERE client_id = ? ORDER BY created_at DESC LIMIT 100", c.id);
  const engagements = all<{ id: string; year: number; service: string; status: Stage; due_date: string | null; updated_at: number }>(
    "SELECT id, year, service, status, due_date, updated_at FROM client_engagements WHERE client_id = ? ORDER BY year DESC, service",
    c.id,
  );
  const events = all<{ kind: string; detail: string; created_at: number; title: string }>(
    `SELECT e.kind, e.detail, e.created_at, r.title FROM doc_request_events e JOIN doc_requests r ON r.id = e.request_id
      WHERE r.client_id = ? ORDER BY e.created_at DESC LIMIT 60`,
    c.id,
  );
  return {
    client: clientDTO(c),
    engagements: engagements.map((e) => ({ id: e.id, year: e.year, service: e.service, status: e.status, dueDate: e.due_date, updatedAt: e.updated_at })),
    requests: reqs.map((r) => ({ ...requestSummary(r), items: items(r.id).map((i) => ({ id: i.id, label: i.label, status: i.status, aiStatus: i.ai_status, ai: i.ai_json ? JSON.parse(i.ai_json) : null, naReason: i.na_reason, feedback: i.feedback, documentId: i.document_id, uploadedAt: i.uploaded_at, required: Boolean(i.required) })) })),
    files: clientFiles(c.id),
    messages: messages(c.id),
    schedules: schedulesFor(c.id),
    events: events.map((e) => ({ kind: e.kind, detail: e.detail, title: e.title, createdAt: e.created_at })),
    portal: { url: portalUrl(ensureSlug(ctx.workspace.id)) },
  };
}

// ---------- the firm's dashboard ----------

export function dashboard(ctx: Ctx, year = seasonYear()) {
  const wid = ctx.workspace.id;
  const clients = listClients(wid, { year });
  const today = new Date().toISOString().slice(0, 10);
  const stages = all<{ status: string; n: number }>(
    `SELECT e.status, COUNT(*) AS n FROM client_engagements e JOIN clients c ON c.id = e.client_id
      WHERE e.workspace_id = ? AND e.year = ? AND c.archived_at IS NULL GROUP BY e.status`,
    wid,
    year,
  );
  const receivedToday = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM doc_request_items i JOIN doc_requests r ON r.id = i.request_id
      WHERE r.workspace_id = ? AND r.client_id IS NOT NULL AND i.status = 'uploaded' AND i.uploaded_at > ?`,
    wid,
    now() - DAY,
  )!.n;
  const unread = get<{ n: number }>("SELECT COUNT(*) AS n FROM client_messages WHERE workspace_id = ? AND author = 'client' AND read_at IS NULL", wid)!.n;
  const nudge = clients
    .filter((c) => c.outstanding > 0 && (!c.lastRemindedAt || now() - c.lastRemindedAt > 3 * DAY))
    .sort((a, b) => b.overdue - a.overdue || (a.lastRemindedAt ?? 0) - (b.lastRemindedAt ?? 0))
    .slice(0, 8);
  const upcoming = all<{ due_date: string; title: string; recipient_name: string; client_id: string }>(
    `SELECT due_date, title, recipient_name, client_id FROM doc_requests WHERE workspace_id = ? AND client_id IS NOT NULL
       AND status IN ('pending','viewed','in_progress') AND due_date IS NOT NULL AND due_date >= ? ORDER BY due_date LIMIT 6`,
    wid,
    today,
  );
  const feed = all<{ kind: string; detail: string; created_at: number; title: string; recipient_name: string; client_id: string }>(
    `SELECT e.kind, e.detail, e.created_at, r.title, r.recipient_name, r.client_id FROM doc_request_events e JOIN doc_requests r ON r.id = e.request_id
      WHERE r.workspace_id = ? AND r.client_id IS NOT NULL AND e.kind IN ('uploaded','submitted','not_applicable','verified','returned','reminded')
      ORDER BY e.created_at DESC LIMIT 14`,
    wid,
  );
  const msgs = all<{ body: string; created_at: number; author_name: string; client_id: string }>(
    "SELECT body, created_at, author_name, client_id FROM client_messages WHERE workspace_id = ? AND author = 'client' ORDER BY created_at DESC LIMIT 6",
    wid,
  );
  const activity = [
    ...feed.map((e) => ({ kind: e.kind, who: e.recipient_name, what: e.detail || e.title, clientId: e.client_id, at: e.created_at })),
    ...msgs.map((m) => ({ kind: "message", who: m.author_name, what: m.body.slice(0, 120), clientId: m.client_id, at: m.created_at })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 14);
  let limit: number | null = null;
  let locked = false;
  try {
    const l = clientLimit(ctx);
    limit = Number.isFinite(l) ? l : null;
  } catch {
    locked = true;
  }
  return {
    year,
    locked,
    kpis: {
      clients: clients.length,
      waiting: clients.filter((c) => c.outstanding > 0).length,
      overdue: clients.filter((c) => c.overdue > 0).length,
      receivedToday,
      needsReview: clients.filter((c) => c.flagged > 0).length + (stages.find((s) => s.status === "docs_in")?.n ?? 0),
      readyToSign: stages.find((s) => s.status === "ready_to_sign")?.n ?? 0,
      unread,
    },
    stages: Object.fromEntries(stages.map((s) => [s.status, s.n])),
    nudge,
    upcoming: upcoming.map((u) => ({ date: u.due_date, label: `${u.recipient_name}: ${u.title}`, clientId: u.client_id })),
    deadlines: deadlines(year).filter((d) => d.date >= today).slice(0, 4),
    activity,
    plan: { limit, used: activeClientCount(wid) },
    brand: brand(firmOf(wid)),
    portalUrl: portalUrl(ensureSlug(wid)),
  };
}

/** For links in emails to the firm. */
export const clientLink = (workspaceId: string, clientId: string) => appUrl(`/app/${workspaceId}/clients/${clientId}`);
export { requestLink };
