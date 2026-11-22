import "server-only";
import { all, get, insert, run } from "./db";
import { id, now, token } from "./ids";
import { createDocument } from "./documents";
import { logActivity, notifyWorkspace } from "./activity";
import { workspaceHasMembership, PAID_LIMITS } from "./billing";
import { importable } from "./cloud";

/**
 * Email in: every workspace can have a private address (name-x7k2q9@in.pdftek.com). Attachments
 * emailed or forwarded to it are saved to the workspace library, so statements, invoices and
 * receipts arrive without uploading anything.
 *
 * An inbound-email service (Postmark, SendGrid Inbound Parse, Mailgun Routes or a Cloudflare Email
 * Worker) posts each message to /api/inbound/email; see INBOUND_EMAIL_DOMAIN and
 * INBOUND_EMAIL_SECRET.
 */

export const inboundDomain = () => (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");

type InboxRow = { workspace_id: string; token: string; allow: "members" | "anyone"; created_by: string; created_at: number };

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "workspace";

export function inbox(workspaceId: string): InboxRow | null {
  return get<InboxRow>("SELECT * FROM email_inboxes WHERE workspace_id = ?", workspaceId) ?? null;
}

export function inboxAddress(workspaceId: string, row: InboxRow | null = inbox(workspaceId)): string | null {
  const domain = inboundDomain();
  if (!row || !domain) return null;
  const ws = get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", workspaceId);
  return `${slug(ws?.name ?? "")}-${row.token}@${domain}`;
}

export function enableInbox(workspaceId: string, userId: string, regenerate = false): InboxRow {
  const cur = inbox(workspaceId);
  if (cur && !regenerate) return cur;
  // Lowercase letters and digits only, so the address survives any mail system.
  const t = token(12).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10).padEnd(10, "x");
  if (cur) run("UPDATE email_inboxes SET token = ? WHERE workspace_id = ?", t, workspaceId);
  else insert("email_inboxes", { workspace_id: workspaceId, token: t, allow: "members", created_by: userId, created_at: now() });
  return inbox(workspaceId)!;
}

export function recentMessages(workspaceId: string) {
  return all<{ id: string; sender: string; subject: string; files: number; status: string; detail: string; created_at: number }>(
    "SELECT * FROM inbound_messages WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 12",
    workspaceId,
  ).map((m) => ({ id: m.id, sender: m.sender, subject: m.subject, files: m.files, status: m.status, detail: m.detail, at: m.created_at }));
}

export type InboundAttachment = { filename: string; contentType: string; content: Buffer; inline?: boolean };
export type InboundMessage = { from: string; to: string[]; subject: string; text?: string; html?: string; attachments: InboundAttachment[] };

function log(workspaceId: string, m: InboundMessage, files: number, status: string, detail: string) {
  insert("inbound_messages", { id: id("inm_"), workspace_id: workspaceId, sender: m.from.slice(0, 200), subject: m.subject.slice(0, 300), files, status, detail: detail.slice(0, 500), created_at: now() });
}

/** Finds the workspace an inbound message is for, from the token in any recipient address. */
function findInbox(m: InboundMessage): InboxRow | null {
  const domain = inboundDomain();
  for (const raw of m.to) {
    const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
    const [local, host] = addr.split("@");
    if (!local || (domain && host !== domain)) continue;
    const t = local.split("-").pop() ?? "";
    const row = get<InboxRow>("SELECT * FROM email_inboxes WHERE token = ?", t);
    if (row) return row;
  }
  return null;
}

const MAX_FILES = 20;

/** Site admins (ADMIN_EMAILS) get every feature, in any workspace they belong to. */
function hasSiteAdmin(workspaceId: string) {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  return all<{ email: string }>("SELECT lower(u.email) AS email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?", workspaceId).some((r) => admins.includes(r.email));
}

/** Saves an inbound message's attachments to the workspace library. Returns what happened. */
export async function receive(m: InboundMessage): Promise<{ status: string; documents: number }> {
  const box = findInbox(m);
  if (!box) return { status: "unknown_address", documents: 0 };
  const wid = box.workspace_id;
  const sender = (m.from.match(/<([^>]+)>/)?.[1] ?? m.from).trim().toLowerCase();

  const today = get<{ n: number }>("SELECT count(*) AS n FROM inbound_messages WHERE workspace_id = ? AND created_at > ?", wid, now() - 86_400_000)?.n ?? 0;
  if (today >= 300) return { status: "rate_limited", documents: 0 };

  // Who may send: workspace members (default), or anyone with the address.
  const member = get<{ user_id: string }>(
    "SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND lower(u.email) = ?",
    wid,
    sender,
  );
  if (box.allow === "members" && !member) {
    log(wid, m, 0, "rejected", `${sender} isn't a member of this workspace. Allow anyone in Settings → Integrations, or invite them.`);
    return { status: "rejected_sender", documents: 0 };
  }
  if (!workspaceHasMembership(wid) && !hasSiteAdmin(wid)) {
    log(wid, m, 0, "rejected", "Email in needs a Day Pass, Pro or Team.");
    notifyWorkspace(wid, { title: "An email couldn't be saved", body: "Email in needs a Day Pass, Pro or Team.", link: `/app/${wid}/settings?tab=billing` });
    return { status: "needs_plan", documents: 0 };
  }

  const userId = member?.user_id ?? box.created_by;
  const maxBytes = PAID_LIMITS.maxFileMb * 1024 * 1024;
  // Real attachments only: skip small inline pictures (logos and signatures in the email body).
  const files = m.attachments.filter((a) => a.content.length && !(a.inline && /^image\//.test(a.contentType) && a.content.length < 60_000)).slice(0, MAX_FILES);
  let saved = 0;
  const problems: string[] = [];
  for (const a of files) {
    const name = (a.filename || "Attachment").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 180);
    if (!importable(name)) {
      problems.push(`${name}: file type not supported`);
      continue;
    }
    if (a.content.length > maxBytes) {
      problems.push(`${name}: larger than ${PAID_LIMITS.maxFileMb} MB`);
      continue;
    }
    try {
      await createDocument({ workspaceId: wid, userId, name, data: a.content, tags: ["email"], actorLabel: `Email from ${sender}` });
      saved++;
    } catch (e) {
      problems.push(`${name}: ${e instanceof Error ? e.message : "couldn't be read"}`);
    }
  }
  // No attachments: keep the message itself (receipts and confirmations often arrive as plain emails).
  if (!files.length && (m.text?.trim() || m.html?.trim())) {
    const title = (m.subject || "Email").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
    try {
      if (m.html?.trim()) await createDocument({ workspaceId: wid, userId, name: `${title}.html`, data: Buffer.from(m.html), tags: ["email"], actorLabel: `Email from ${sender}` });
      else await createDocument({ workspaceId: wid, userId, name: `${title}.txt`, data: Buffer.from(`From: ${m.from}\nSubject: ${m.subject}\n\n${m.text}`), tags: ["email"], actorLabel: `Email from ${sender}` });
      saved++;
    } catch {
      try {
        await createDocument({ workspaceId: wid, userId, name: `${title}.txt`, data: Buffer.from(`From: ${m.from}\nSubject: ${m.subject}\n\n${m.text ?? ""}`), tags: ["email"], actorLabel: `Email from ${sender}` });
        saved++;
      } catch (e) {
        problems.push(`Message: ${e instanceof Error ? e.message : "couldn't be saved"}`);
      }
    }
  }
  log(wid, m, saved, saved ? (problems.length ? "partial" : "saved") : "failed", problems.join("; "));
  if (saved) {
    logActivity({ workspaceId: wid, actorLabel: sender, action: "emailed_in", meta: { files: saved, subject: m.subject } });
    notifyWorkspace(wid, { title: `${saved} file${saved === 1 ? "" : "s"} arrived by email`, body: `From ${sender}${m.subject ? `: ${m.subject}` : ""}`, link: `/app/${wid}` });
  }
  return { status: saved ? "saved" : "failed", documents: saved };
}

// ---------- parsing the formats inbound-email services post ----------

/** Raw RFC 822 message (Cloudflare Email Workers, SendGrid "send raw", Mailgun MIME). */
export async function parseRaw(raw: string | Uint8Array, envelopeTo: string[] = []): Promise<InboundMessage> {
  const { default: PostalMime } = await import("postal-mime");
  const e = await PostalMime.parse(raw);
  const addr = (a?: { address?: string; name?: string } | null) => a?.address ?? "";
  return {
    from: addr(e.from as { address?: string }),
    to: [...envelopeTo, ...((e.to ?? []) as { address?: string }[]).map(addr), ...((e.cc ?? []) as { address?: string }[]).map(addr)].filter(Boolean),
    subject: e.subject ?? "",
    text: e.text ?? undefined,
    html: e.html ?? undefined,
    attachments: (e.attachments ?? []).map((a) => ({
      filename: a.filename ?? "Attachment",
      contentType: a.mimeType ?? "application/octet-stream",
      content: Buffer.from(typeof a.content === "string" ? Buffer.from(a.content) : new Uint8Array(a.content as ArrayBuffer)),
      inline: a.disposition === "inline",
    })),
  };
}

/** Postmark (and similar) JSON: From, ToFull/To, Subject, Attachments[{Name, Content(base64), ContentType}]. */
export function parseJson(b: Record<string, unknown>): InboundMessage {
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const toFull = Array.isArray(b.ToFull) ? (b.ToFull as { Email?: string }[]).map((t) => t.Email ?? "") : [];
  const to = [...toFull, ...s("To").split(","), ...s("to").split(","), ...s("OriginalRecipient").split(",")].map((x) => x.trim()).filter(Boolean);
  const from = (b.FromFull as { Email?: string } | undefined)?.Email || s("From") || s("from");
  const list = (Array.isArray(b.Attachments) ? b.Attachments : Array.isArray(b.attachments) ? b.attachments : []) as Record<string, unknown>[];
  return {
    from,
    to,
    subject: s("Subject") || s("subject"),
    text: s("TextBody") || s("text") || undefined,
    html: s("HtmlBody") || s("html") || undefined,
    attachments: list.map((a) => ({
      filename: String(a.Name ?? a.filename ?? "Attachment"),
      contentType: String(a.ContentType ?? a.contentType ?? "application/octet-stream"),
      content: Buffer.from(String(a.Content ?? a.content ?? ""), "base64"),
      inline: Boolean(a.ContentID && /^image\//.test(String(a.ContentType ?? ""))),
    })),
  };
}

/** Multipart form posts (SendGrid Inbound Parse, Mailgun Routes). */
export async function parseForm(form: FormData): Promise<InboundMessage> {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  let envelopeTo: string[] = [];
  try {
    const env = JSON.parse(str("envelope") || "{}") as { to?: string[] };
    envelopeTo = env.to ?? [];
  } catch {}
  // SendGrid with "POST the raw, full MIME message" turned on.
  if (str("email")) return parseRaw(str("email"), envelopeTo);
  // Mailgun "store and notify" with MIME.
  if (str("body-mime")) return parseRaw(str("body-mime"), [str("recipient")]);
  const attachments: InboundAttachment[] = [];
  for (const [, v] of form.entries()) {
    if (typeof v !== "string") attachments.push({ filename: v.name || "Attachment", contentType: v.type || "application/octet-stream", content: Buffer.from(await v.arrayBuffer()) });
  }
  return {
    from: str("sender") || str("from") || str("From"),
    to: [...envelopeTo, ...str("recipient").split(","), ...str("to").split(","), ...str("To").split(",")].map((x) => x.trim()).filter(Boolean),
    subject: str("subject") || str("Subject"),
    text: str("body-plain") || str("text") || undefined,
    html: str("body-html") || str("html") || undefined,
    attachments,
  };
}
