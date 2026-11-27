import "server-only";
import crypto from "node:crypto";
import { all, get, insert, run, tx, update } from "./db";
import { id, now, sha256, token } from "./ids";
import { HttpError, badRequest, notFound } from "./http";
import { appUrl, sendMail } from "./mail";
import { stripe } from "./stripe";
import { logActivity } from "./activity";
import { inviteSigner, type SignatureRequestRow, type SignerRow } from "./signing";

/**
 * E-signature templates, bulk sends and public signing links.
 *
 * A template is a document plus signer roles ("Client", "Me") and the fields each role fills.
 * Everything built on it (sending to named people, bulk sends from a spreadsheet, and public
 * signing links) creates ordinary envelopes, so signing, reminders, the audit certificate and
 * the activity trail work exactly as for envelopes set up by hand.
 */

export type FieldKind = "signature" | "initials" | "date" | "name" | "text";
export type TemplateRole = { key: string; label: string; name?: string; email?: string };
export type TemplateField = { roleKey: string; page: number; x: number; y: number; w: number; h: number; kind: FieldKind };

export type TemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  document_id: string;
  version_id: string;
  page_count: number;
  title: string;
  message: string;
  sequential: number;
  roles_json: string;
  fields_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type LinkRow = {
  id: string;
  workspace_id: string;
  template_id: string;
  slug: string;
  title: string;
  role_key: string;
  fixed_json: string;
  verify_email: number;
  payment_cents: number | null;
  payment_currency: string | null;
  payment_desc: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  active: number;
  created_by: string;
  created_at: number;
};

export const roles = (t: TemplateRow) => JSON.parse(t.roles_json) as TemplateRole[];
export const fields = (t: TemplateRow) => JSON.parse(t.fields_json) as TemplateField[];

export function getTemplate(workspaceId: string, templateId: string): TemplateRow {
  const t = get<TemplateRow>("SELECT * FROM sign_templates WHERE id = ? AND workspace_id = ?", templateId, workspaceId);
  if (!t) throw notFound("Template not found.");
  return t;
}

export function templateDTO(t: TemplateRow) {
  const doc = get<{ name: string; deleted_at: number | null }>("SELECT name, deleted_at FROM documents WHERE id = ?", t.document_id);
  const counts = get<{ sent: number }>("SELECT count(*) AS sent FROM signature_requests WHERE template_id = ?", t.id);
  const links = get<{ n: number }>("SELECT count(*) AS n FROM sign_links WHERE template_id = ? AND active = 1", t.id);
  return {
    id: t.id,
    name: t.name,
    title: t.title,
    message: t.message,
    sequential: Boolean(t.sequential),
    documentId: t.document_id,
    documentName: doc?.name ?? "Deleted document",
    versionId: t.version_id,
    pageCount: t.page_count,
    roles: roles(t),
    fields: fields(t),
    sent: counts?.sent ?? 0,
    activeLinks: links?.n ?? 0,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

/** Checks a template's roles and fields (each role needs a signature field). */
export function validateTemplate(r: TemplateRole[], f: TemplateField[], pageCount: number) {
  if (!r.length) throw badRequest("Add at least one signer role.");
  const keys = new Set(r.map((x) => x.key));
  if (keys.size !== r.length) throw badRequest("Each role needs a unique key.");
  const labels = new Set(r.map((x) => x.label.trim().toLowerCase()));
  if (labels.size !== r.length) throw badRequest("Give each role a different name (for example Client and Company).");
  for (const role of r) {
    if (!f.some((x) => x.roleKey === role.key && x.kind === "signature")) throw badRequest(`Place a Signature field for ${role.label}.`);
    if (role.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(role.email)) throw badRequest(`The email for ${role.label} isn't valid.`);
  }
  if (f.some((x) => !keys.has(x.roleKey) || x.page > pageCount)) throw badRequest("A field refers to an unknown role or page.");
}

// ---------- envelopes ----------

export type EnvelopeSigner = {
  key: string;
  name: string;
  email: string;
  auth?: "email_link" | "public_link" | "public_link_verified";
  payment?: { cents: number; currency: string; desc: string };
};

/**
 * Creates and sends an envelope from a template. `invite` decides who is emailed now: everyone
 * (or the first signer, when signing in order), or nobody (a signing-link visitor signs right away).
 */
export async function createEnvelope(opts: {
  template: TemplateRow;
  createdBy: string;
  senderName: string;
  title: string;
  message: string;
  sequential: boolean;
  signers: EnvelopeSigner[];
  linkId?: string;
  batchId?: string;
  invite: "auto" | "none";
}) {
  const t = opts.template;
  const emails = opts.signers.map((s) => s.email.toLowerCase());
  if (new Set(emails).size !== emails.length) throw badRequest("Each signer needs a different email address.");
  const rid = id("sig_");
  const ids: Record<string, string> = {};
  tx(() => {
    insert("signature_requests", {
      id: rid,
      workspace_id: t.workspace_id,
      document_id: t.document_id,
      version_id: t.version_id,
      title: opts.title,
      message: opts.message,
      status: "sent",
      sequential: opts.sequential ? 1 : 0,
      created_by: opts.createdBy,
      created_at: now(),
      sent_at: now(),
      template_id: t.id,
      link_id: opts.linkId ?? null,
      batch_id: opts.batchId ?? null,
    });
    opts.signers.forEach((s, i) => {
      ids[s.key] = id("sgn_");
      insert("signers", {
        id: ids[s.key],
        request_id: rid,
        name: s.name,
        email: s.email.toLowerCase(),
        order_index: i,
        token: token(),
        status: "pending",
        auth: s.auth ?? "email_link",
        payment_status: s.payment ? "due" : null,
        payment_cents: s.payment?.cents ?? null,
        payment_currency: s.payment?.currency ?? null,
        payment_desc: s.payment?.desc ?? null,
      });
    });
    for (const f of fields(t)) {
      const sid = ids[f.roleKey];
      if (!sid) continue;
      insert("signature_fields", { id: id("fld_"), request_id: rid, signer_id: sid, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, kind: f.kind });
    }
  });
  const req = get<SignatureRequestRow>("SELECT * FROM signature_requests WHERE id = ?", rid)!;
  const signers = all<SignerRow>("SELECT * FROM signers WHERE request_id = ? ORDER BY order_index", rid);
  let delivered = 0;
  if (opts.invite === "auto") {
    for (const s of opts.sequential ? signers.slice(0, 1) : signers) if ((await inviteSigner(req, s, opts.senderName)).delivered) delivered++;
  }
  return { id: rid, delivered, signers };
}

// ---------- public signing links ----------

export function getLinkBySlug(slug: string): LinkRow {
  const l = get<LinkRow>("SELECT * FROM sign_links WHERE slug = ?", slug);
  if (!l) throw notFound("This signing link doesn't exist.");
  return l;
}

/** Why a link can't be used right now, in words for the visitor (or null if it can). */
export function linkClosed(l: LinkRow): string | null {
  if (!l.active) return "This signing link has been turned off by its owner.";
  if (l.expires_at && l.expires_at < now()) return "This signing link has expired.";
  if (l.max_uses && l.uses >= l.max_uses) return "This signing link has reached its limit and can't be used again.";
  return null;
}

export function linkDTO(l: LinkRow) {
  const t = get<TemplateRow>("SELECT * FROM sign_templates WHERE id = ?", l.template_id);
  const signed = get<{ n: number }>(
    "SELECT count(*) AS n FROM signers s JOIN signature_requests r ON r.id = s.request_id WHERE r.link_id = ? AND s.status = 'signed' AND s.auth != 'email_link'",
    l.id,
  );
  const paid = get<{ n: number; cents: number }>(
    "SELECT count(*) AS n, coalesce(sum(s.payment_cents), 0) AS cents FROM signers s JOIN signature_requests r ON r.id = s.request_id WHERE r.link_id = ? AND s.payment_status = 'paid'",
    l.id,
  );
  return {
    id: l.id,
    title: l.title,
    url: appUrl(`/s/${l.slug}`),
    templateId: l.template_id,
    templateName: t?.name ?? "Deleted template",
    roleKey: l.role_key,
    roleLabel: (t ? roles(t) : []).find((r) => r.key === l.role_key)?.label ?? "Signer",
    verifyEmail: Boolean(l.verify_email),
    payment: l.payment_cents ? { cents: l.payment_cents, currency: l.payment_currency ?? "usd", desc: l.payment_desc ?? "" } : null,
    maxUses: l.max_uses,
    uses: l.uses,
    signed: signed?.n ?? 0,
    paid: paid?.n ?? 0,
    paidCents: paid?.cents ?? 0,
    expiresAt: l.expires_at,
    active: Boolean(l.active),
    closed: linkClosed(l),
    createdAt: l.created_at,
  };
}

const CODE_TTL = 15 * 60_000;
const codeHash = (codeId: string, code: string) => sha256(`${codeId}:${code}`);

/** Emails a 6-digit code to confirm a signing-link visitor's address. */
export async function sendLinkCode(l: LinkRow, name: string, email: string) {
  const recent = get<{ created_at: number }>("SELECT created_at FROM sign_link_codes WHERE link_id = ? AND email = ? ORDER BY created_at DESC LIMIT 1", l.id, email);
  if (recent && now() - recent.created_at < 30_000) throw new HttpError(429, "A code was just sent. Check your inbox (and spam folder), or try again in a moment.");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const cid = id("slc_");
  insert("sign_link_codes", { id: cid, link_id: l.id, name, email, code_hash: codeHash(cid, code), expires_at: now() + CODE_TTL, created_at: now() });
  const ws = get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", l.workspace_id);
  const sent = await sendMail({
    to: email,
    subject: `${code} is your pdftek signing code`,
    heading: `Your code: ${code}`,
    paragraphs: [`Enter this code to sign “${l.title}”${ws ? ` for ${ws.name}` : ""}. It expires in 15 minutes.`, "If you didn't ask for this, you can ignore this email."],
    footer: "Sent by pdftek e-sign.",
  });
  if (!sent.delivered) throw new HttpError(503, "We couldn't send the code email right now. Please try again in a few minutes.");
  return cid;
}

export function checkLinkCode(l: LinkRow, codeId: string, code: string): { name: string; email: string } {
  const row = get<{ id: string; name: string; email: string; code_hash: string; attempts: number; expires_at: number }>(
    "SELECT * FROM sign_link_codes WHERE id = ? AND link_id = ?",
    codeId,
    l.id,
  );
  if (!row || row.expires_at < now()) throw badRequest("That code has expired. Request a new one.");
  if (row.attempts >= 5) throw new HttpError(429, "Too many wrong codes. Request a new one.");
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(codeHash(row.id, code.replace(/\D/g, ""))));
  if (!ok) {
    run("UPDATE sign_link_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
    throw badRequest("That code isn't right. Check the latest email and try again.");
  }
  run("DELETE FROM sign_link_codes WHERE id = ?", row.id);
  return { name: row.name, email: row.email };
}

/** Creates the visitor's own envelope from a signing link and returns their signing address. */
export async function startFromLink(l: LinkRow, visitor: { name: string; email: string; verified: boolean }) {
  const closed = linkClosed(l);
  if (closed) throw badRequest(closed);
  const t = get<TemplateRow>("SELECT * FROM sign_templates WHERE id = ?", l.template_id);
  if (!t) throw notFound("This signing link's document is no longer available.");
  const fixed = JSON.parse(l.fixed_json) as Record<string, { name: string; email: string }>;
  const owner = get<{ name: string }>("SELECT name FROM users WHERE id = ?", l.created_by);
  const ordered = roles(t).sort((a, b) => (a.key === l.role_key ? -1 : b.key === l.role_key ? 1 : 0));
  const signers: EnvelopeSigner[] = ordered.map((r) =>
    r.key === l.role_key
      ? {
          key: r.key,
          name: visitor.name,
          email: visitor.email,
          auth: visitor.verified ? "public_link_verified" : "public_link",
          payment: l.payment_cents ? { cents: l.payment_cents, currency: l.payment_currency ?? "usd", desc: l.payment_desc || l.title } : undefined,
        }
      : { key: r.key, name: fixed[r.key]?.name ?? r.name ?? "", email: fixed[r.key]?.email ?? r.email ?? "" },
  );
  if (signers.some((s) => !s.name || !s.email)) throw badRequest("This signing link isn't fully set up yet. Please contact its owner.");
  run("UPDATE sign_links SET uses = uses + 1 WHERE id = ?", l.id);
  // The visitor signs first, on the spot; anyone else (a countersigner) is invited after them.
  const env = await createEnvelope({
    template: t,
    createdBy: l.created_by,
    senderName: owner?.name ?? "pdftek",
    title: `${l.title} — ${visitor.name}`,
    message: t.message,
    sequential: signers.length > 1,
    signers,
    linkId: l.id,
    invite: "none",
  });
  logActivity({ workspaceId: l.workspace_id, actorLabel: visitor.name, action: "signing_link_started", documentId: t.document_id, meta: { title: l.title, email: visitor.email } });
  return { url: appUrl(`/sign/${env.signers[0].token}`), token: env.signers[0].token };
}

// ---------- payments (Stripe Connect) ----------

export const paymentsAvailable = () => Boolean(process.env.STRIPE_SECRET_KEY);

export function workspacePayments(workspaceId: string) {
  const ws = get<{ stripe_account_id: string | null; stripe_account_ready: number }>("SELECT stripe_account_id, stripe_account_ready FROM workspaces WHERE id = ?", workspaceId);
  return { available: paymentsAvailable(), accountId: ws?.stripe_account_id ?? null, ready: Boolean(ws?.stripe_account_ready) };
}

export function formatMoney(cents: number, currency = "usd") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Starts a Stripe Checkout for a signer's payment, paid to the workspace's connected account. */
export async function paymentCheckout(signer: SignerRow & { payment_status: string | null; payment_cents: number | null; payment_currency: string | null; payment_desc: string | null }, workspaceId: string) {
  if (signer.payment_status !== "due" || !signer.payment_cents) throw badRequest("There's nothing to pay here.");
  const pay = workspacePayments(workspaceId);
  if (!pay.accountId || !pay.ready) throw badRequest("Payments aren't set up for this document yet. Please contact the sender.");
  const fee = Math.round((signer.payment_cents * (Number(process.env.PDFTEK_PAYMENT_FEE_PERCENT) || 0)) / 100);
  const back = appUrl(`/sign/${signer.token}`);
  const session = await stripe<{ id: string; url: string }>(
    "/checkout/sessions",
    {
      mode: "payment",
      customer_email: signer.email,
      line_items: { 0: { quantity: 1, price_data: { currency: signer.payment_currency ?? "usd", unit_amount: signer.payment_cents, product_data: { name: signer.payment_desc || "Payment" } } } },
      payment_intent_data: fee > 0 ? { application_fee_amount: fee } : undefined,
      metadata: { signer_id: signer.id },
      success_url: `${back}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: back,
    },
    "POST",
    pay.accountId,
  );
  update("signers", signer.id, { payment_session: session.id });
  return session.url;
}

/** Confirms a finished checkout (on return from Stripe) and records the payment. */
export async function confirmPayment(signer: SignerRow & { payment_status: string | null; payment_session: string | null }, req: SignatureRequestRow, sessionId: string) {
  if (signer.payment_status === "paid") return true;
  if (!signer.payment_session || signer.payment_session !== sessionId) return false;
  const pay = workspacePayments(req.workspace_id);
  if (!pay.accountId) return false;
  const s = await stripe<{ payment_status: string; amount_total: number; currency: string }>(`/checkout/sessions/${encodeURIComponent(sessionId)}`, {}, "GET", pay.accountId);
  if (s.payment_status !== "paid") return false;
  update("signers", signer.id, { payment_status: "paid", paid_at: now() });
  logActivity({ workspaceId: req.workspace_id, actorLabel: signer.name, action: "signing_payment", documentId: req.document_id, meta: { title: req.title, amount: formatMoney(s.amount_total, s.currency) } });
  const { notify } = await import("./activity");
  notify({ userId: req.created_by, workspaceId: req.workspace_id, title: `${signer.name} paid ${formatMoney(s.amount_total, s.currency)}`, body: req.title, link: `/app/${req.workspace_id}/signatures` });
  return true;
}
