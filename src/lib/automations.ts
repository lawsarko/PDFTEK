import "server-only";
import { z } from "zod";
import { all, get, insert, run, update } from "./db";
import { id, now } from "./ids";
import { logActivity, notify, notifyWorkspace } from "./activity";
import { sendMail, appUrl } from "./mail";
import { aiConfigured, complete, extract, EXTRACT_PRESETS } from "./ai";
import type { DocumentRow } from "./documents";

// ---------- schema ----------

export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("document_uploaded"),
    nameContains: z.string().max(100).optional().default(""),
  }),
  z.object({
    type: z.literal("schedule"),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    tzOffset: z.number().int().min(-840).max(840), // minutes, as reported by Date#getTimezoneOffset
  }),
  z.object({ type: z.literal("signature_completed") }),
  z.object({ type: z.literal("request_completed") }),
  z.object({
    type: z.literal("renewal_upcoming"),
    daysBefore: z.number().int().min(1).max(365),
    tzOffset: z.number().int().min(-840).max(840),
  }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("extract"), preset: z.enum(Object.keys(EXTRACT_PRESETS) as [string, ...string[]]) }),
  z.object({ type: z.literal("summarize") }),
  z.object({ type: z.literal("tag"), tag: z.string().min(1).max(40) }),
  z.object({ type: z.literal("notify"), audience: z.enum(["workspace", "me"]) }),
  z.object({ type: z.literal("email"), to: z.string().min(3).max(500) }),
  z.object({ type: z.literal("webhook"), url: z.string().url().max(500) }),
  z.object({ type: z.literal("assign"), userId: z.string() }),
]);
export type Action = z.infer<typeof ActionSchema>;

export type AutomationRow = {
  id: string;
  workspace_id: string;
  name: string;
  enabled: number;
  trigger_type: string;
  trigger_json: string;
  actions_json: string;
  created_by: string;
  created_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
};

// ---------- scheduling ----------

/** Next time (epoch ms) that local wall-clock `time` on one of `days` occurs, in a fixed UTC offset. */
export function nextScheduled(trigger: { time: string; days: number[]; tzOffset: number }, from = now()): number {
  const [hh, mm] = trigger.time.split(":").map(Number);
  // Shift into the user's local frame, find the slot, shift back.
  const local = new Date(from - trigger.tzOffset * 60_000);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, hh, mm));
    const candidate = d.getTime() + trigger.tzOffset * 60_000;
    if (candidate > from && trigger.days.includes(d.getUTCDay())) return candidate;
  }
  return from + 24 * 3600_000;
}

export function computeNextRun(trigger: Trigger, from = now()): number | null {
  if (trigger.type === "schedule") return nextScheduled(trigger, from);
  if (trigger.type === "renewal_upcoming") return nextScheduled({ time: "09:00", days: [0, 1, 2, 3, 4, 5, 6], tzOffset: trigger.tzOffset }, from);
  return null;
}

// ---------- execution ----------

type RunContext = {
  workspaceId: string;
  documentId?: string;
  headline: string;
  lines: string[];
};

const MAX_LOG = 4000;

async function runActions(a: AutomationRow, ctx: RunContext) {
  const actions = JSON.parse(a.actions_json) as Action[];
  const log: string[] = [];
  const doc = ctx.documentId ? get<DocumentRow>("SELECT * FROM documents WHERE id = ?", ctx.documentId) : undefined;
  const ws = get<{ name: string; playbook: string }>("SELECT name, playbook FROM workspaces WHERE id = ?", a.workspace_id)!;
  let status = "success";

  for (const action of actions) {
    try {
      switch (action.type) {
        case "extract":
        case "summarize": {
          if (!doc) {
            log.push(`${action.type}: skipped (no document in this trigger)`);
            break;
          }
          if (!aiConfigured()) {
            log.push(`${action.type}: skipped (AI not configured)`);
            break;
          }
          const { workspaceCanUseAi, chargeAiWorkspace } = await import("./billing");
          if (!workspaceCanUseAi(a.workspace_id)) {
            log.push(`${action.type}: skipped (out of AI credits)`);
            status = "error";
            break;
          }
          const onUsage = (model: string, usage: { input_tokens: number; output_tokens: number }) =>
            void chargeAiWorkspace(a.workspace_id, model, usage, `Automation: ${a.name}`);
          const { readCurrentPdf, pageTexts } = await import("./documents");
          const pdf = await readCurrentPdf(doc);
          const source = { kind: "pdf" as const, title: doc.name, pdf, fallbackText: pageTexts(doc.id).map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n") };
          if (action.type === "extract") {
            const result = await extract({ source, preset: action.preset, playbook: ws.playbook, onUsage });
            insert("extractions", {
              id: id("ext_"),
              document_id: doc.id,
              preset: action.preset,
              title: EXTRACT_PRESETS[action.preset].title,
              result_json: JSON.stringify(result),
              created_by: null,
              created_at: now(),
            });
            ctx.lines.push(`${EXTRACT_PRESETS[action.preset].title}: ${result.summary}`);
            const high = result.tables.flatMap((t) => t.rows).filter((r) => /^high$/i.test(r[0] ?? ""));
            if (action.preset === "risks" && high.length) ctx.lines.push(`High-severity flags: ${high.map((r) => r[1]).join("; ")}`);
            log.push(`extract(${action.preset}): ${result.tables.reduce((n, t) => n + t.rows.length, 0)} rows`);
          } else {
            const summary = await complete({
              system: "Summarize business documents for a busy professional. 4-6 bullet points, plain text, lead with what matters most (parties, money, dates, obligations, risks).",
              sources: [source],
              prompt: "Summarize this document.",
              onUsage,
            });
            insert("extractions", {
              id: id("ext_"),
              document_id: doc.id,
              preset: "summary",
              title: "Summary",
              result_json: JSON.stringify({ summary, tables: [] }),
              created_by: null,
              created_at: now(),
            });
            ctx.lines.push(`Summary:\n${summary}`);
            log.push("summarize: done");
          }
          break;
        }
        case "tag": {
          if (!doc) break;
          const fresh = get<{ tags: string }>("SELECT tags FROM documents WHERE id = ?", doc.id)!;
          const tags = new Set(JSON.parse(fresh.tags) as string[]);
          tags.add(action.tag);
          run("UPDATE documents SET tags = ? WHERE id = ?", JSON.stringify([...tags]), doc.id);
          log.push(`tag: ${action.tag}`);
          break;
        }
        case "assign": {
          if (!doc) break;
          const member = get("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?", a.workspace_id, action.userId);
          if (!member) {
            log.push("assign: skipped (user is no longer a member)");
            break;
          }
          run("UPDATE documents SET assigned_to = ? WHERE id = ?", action.userId, doc.id);
          notify({ userId: action.userId, workspaceId: a.workspace_id, title: `${doc.name} was assigned to you`, body: `By automation "${a.name}"`, link: `/app/${a.workspace_id}?doc=${doc.id}` });
          log.push("assign: done");
          break;
        }
        case "notify": {
          const payload = { title: `${a.name}: ${ctx.headline}`, body: ctx.lines.join("\n").slice(0, 1000), link: doc ? `/app/${a.workspace_id}?doc=${doc.id}` : `/app/${a.workspace_id}` };
          if (action.audience === "workspace") notifyWorkspace(a.workspace_id, payload);
          else notify({ userId: a.created_by, workspaceId: a.workspace_id, ...payload });
          log.push(`notify: ${action.audience}`);
          break;
        }
        case "email": {
          const recipients = action.to.split(/[,;\s]+/).filter((e) => /.+@.+\..+/.test(e)).slice(0, 20);
          for (const to of recipients) {
            await sendMail({
              to,
              subject: `[${ws.name}] ${a.name}: ${ctx.headline}`,
              heading: ctx.headline,
              paragraphs: ctx.lines.length ? ctx.lines : ["No new items."],
              cta: { label: "Open in pdftek", url: appUrl(doc ? `/app/${a.workspace_id}?doc=${doc.id}` : `/app/${a.workspace_id}`) },
            });
          }
          log.push(`email: ${recipients.length} recipient(s)`);
          break;
        }
        case "webhook": {
          const res = await fetch(action.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: `*${a.name}*: ${ctx.headline}\n${ctx.lines.join("\n")}`.slice(0, 3500),
              automation: a.name,
              workspace: ws.name,
              headline: ctx.headline,
              details: ctx.lines,
              document: doc ? { id: doc.id, name: doc.name, url: appUrl(`/app/${a.workspace_id}?doc=${doc.id}`) } : null,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          log.push(`webhook: HTTP ${res.status}`);
          if (!res.ok) status = "partial";
          break;
        }
      }
    } catch (err) {
      status = "partial";
      log.push(`${action.type}: failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  insert("automation_runs", {
    id: id("run_"),
    automation_id: a.id,
    status,
    log: log.join("\n").slice(0, MAX_LOG),
    document_id: ctx.documentId ?? null,
    created_at: now(),
  });
  update("automations", a.id, { last_run_at: now() });
  logActivity({ workspaceId: a.workspace_id, actorLabel: `Automation · ${a.name}`, action: "automation_ran", documentId: ctx.documentId, meta: { status } });
}

export async function runAutomationNow(a: AutomationRow, documentId?: string) {
  const trigger = JSON.parse(a.trigger_json) as Trigger;
  if (trigger.type === "schedule" || (trigger.type !== "renewal_upcoming" && !documentId)) {
    await runActions(a, await digestContext(a));
  } else if (trigger.type === "renewal_upcoming") {
    await checkRenewals(a, trigger, true);
  } else {
    const doc = get<{ name: string }>("SELECT name FROM documents WHERE id = ?", documentId);
    await runActions(a, { workspaceId: a.workspace_id, documentId, headline: doc?.name ?? "Document", lines: [] });
  }
}

/** Builds a workspace digest: new documents, open requests, pending signatures since the last run. */
async function digestContext(a: AutomationRow): Promise<RunContext> {
  const since = a.last_run_at ?? now() - 24 * 3600_000;
  const docs = all<{ name: string; created_at: number }>(
    "SELECT name, created_at FROM documents WHERE workspace_id = ? AND deleted_at IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 50",
    a.workspace_id,
    since,
  );
  const reqs = all<{ title: string; recipient_name: string; status: string; due_date: string | null }>(
    "SELECT title, recipient_name, status, due_date FROM doc_requests WHERE workspace_id = ? AND status IN ('pending','viewed') ORDER BY due_date",
    a.workspace_id,
  );
  const sigs = all<{ title: string; pending: number }>(
    `SELECT r.title, (SELECT COUNT(*) FROM signers s WHERE s.request_id = r.id AND s.status != 'signed') AS pending
       FROM signature_requests r WHERE r.workspace_id = ? AND r.status = 'sent'`,
    a.workspace_id,
  );
  const lines: string[] = [];
  lines.push(docs.length ? `New documents (${docs.length}): ${docs.map((d) => d.name).join(", ")}` : "No new documents.");
  if (reqs.length) lines.push(`Open document requests (${reqs.length}): ${reqs.map((r) => `${r.title} from ${r.recipient_name}${r.due_date ? ` (due ${r.due_date})` : ""} — ${r.status}`).join("; ")}`);
  if (sigs.length) lines.push(`Awaiting signatures (${sigs.length}): ${sigs.map((s) => `${s.title} (${s.pending} pending)`).join("; ")}`);
  return { workspaceId: a.workspace_id, headline: `Digest — ${new Date().toDateString()}`, lines };
}

const RENEWAL_WORDS = /(expir|renew|terminat|end of (the )?term|notice)/i;

/** Scans saved "Dates & deadlines" extractions for dates that fall `daysBefore` days from today. */
async function checkRenewals(a: AutomationRow, trigger: Extract<Trigger, { type: "renewal_upcoming" }>, force = false) {
  const rows = all<{ document_id: string; name: string; result_json: string }>(
    `SELECT e.document_id, d.name, e.result_json FROM extractions e JOIN documents d ON d.id = e.document_id
      WHERE d.workspace_id = ? AND d.deleted_at IS NULL AND e.preset IN ('dates','key_terms')
      ORDER BY e.created_at DESC`,
    a.workspace_id,
  );
  const today = new Date(now() - trigger.tzOffset * 60_000);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const seenDocs = new Set<string>();
  let fired = 0;
  for (const r of rows) {
    if (seenDocs.has(r.document_id)) continue; // newest extraction per document only
    seenDocs.add(r.document_id);
    const result = JSON.parse(r.result_json) as { tables: { rows: string[][] }[] };
    for (const row of result.tables.flatMap((t) => t.rows)) {
      const label = row[0] ?? "";
      if (!RENEWAL_WORDS.test(label)) continue;
      const dateStr = row.slice(1).join(" ").match(/\b(\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]+ \d{4})\b/)?.[1];
      if (!dateStr) continue;
      const parsed = Date.parse(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : `${dateStr} UTC`);
      if (Number.isNaN(parsed)) continue;
      const daysLeft = Math.round((parsed - todayUtc) / 86_400_000);
      if (daysLeft !== trigger.daysBefore && !(force && daysLeft >= 0 && daysLeft <= trigger.daysBefore)) continue;
      const key = `renewal:${a.id}:${r.document_id}:${dateStr}:${label}`;
      if (!force && get("SELECT 1 FROM reminders_sent WHERE key = ?", key)) continue;
      run("INSERT OR IGNORE INTO reminders_sent (key, created_at) VALUES (?, ?)", key, now());
      fired++;
      await runActions(a, {
        workspaceId: a.workspace_id,
        documentId: r.document_id,
        headline: `${r.name}: ${label} in ${daysLeft} days`,
        lines: [`${label} — ${dateStr} (${daysLeft} days from today).`, `Source row: ${row.join(" | ")}`],
      });
    }
  }
  if (force && fired === 0) {
    await runActions(a, {
      workspaceId: a.workspace_id,
      headline: "No upcoming renewals",
      lines: [`No renewal or expiry dates within ${trigger.daysBefore} days were found. Run "Dates & deadlines" extraction on your contracts so pdftek can track them.`],
    });
  }
}

// ---------- event entry points ----------

export async function onEvent(
  type: "document_uploaded" | "signature_completed" | "request_completed",
  ctx: { workspaceId: string; documentId?: string; headline?: string; lines?: string[] },
) {
  const autos = all<AutomationRow>("SELECT * FROM automations WHERE workspace_id = ? AND enabled = 1 AND trigger_type = ?", ctx.workspaceId, type);
  for (const a of autos) {
    const trigger = JSON.parse(a.trigger_json) as Trigger;
    let headline = ctx.headline ?? "";
    if (ctx.documentId) {
      const doc = get<{ name: string }>("SELECT name FROM documents WHERE id = ?", ctx.documentId);
      if (!doc) continue;
      if (trigger.type === "document_uploaded" && trigger.nameContains && !doc.name.toLowerCase().includes(trigger.nameContains.toLowerCase())) continue;
      headline ||= doc.name;
    }
    try {
      await runActions(a, { workspaceId: ctx.workspaceId, documentId: ctx.documentId, headline, lines: [...(ctx.lines ?? [])] });
    } catch (err) {
      console.error("[pdftek] automation failed", a.id, err);
    }
  }
}

let ticking = false;
let lastCleanup = 0;

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    if (now() - lastCleanup > 3_600_000) {
      lastCleanup = now();
      const { cleanupGuests } = await import("./billing");
      await cleanupGuests().catch((err) => console.error("[pdftek] guest cleanup failed", err));
    }
    const due = all<AutomationRow>("SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?", now());
    for (const a of due) {
      const trigger = JSON.parse(a.trigger_json) as Trigger;
      // Advance first so a crash can't cause a tight re-run loop.
      update("automations", a.id, { next_run_at: computeNextRun(trigger, now() + 1000) });
      try {
        if (trigger.type === "schedule") await runActions(a, await digestContext(a));
        else if (trigger.type === "renewal_upcoming") await checkRenewals(a, trigger);
      } catch (err) {
        console.error("[pdftek] scheduled automation failed", a.id, err);
      }
    }
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  const g = globalThis as typeof globalThis & { __pdftekScheduler?: NodeJS.Timeout };
  if (g.__pdftekScheduler) return;
  g.__pdftekScheduler = setInterval(() => void tick(), 60_000);
  setTimeout(() => void tick(), 5_000);
  console.info("[pdftek] automation scheduler started");
}
