import { z } from "zod";
import { get } from "@/lib/db";
import { badRequest, body, clientIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { checkLinkCode, formatMoney, getLinkBySlug, linkClosed, sendLinkCode, startFromLink, workspacePayments, type TemplateRow } from "@/lib/esign";

type P = { params: Promise<{ slug: string }> };

/** What a visitor sees before signing through a public link. */
export const GET = route<P>(async (_req, { params }) => {
  const { slug } = await params;
  const l = getLinkBySlug(slug);
  const t = get<TemplateRow & { doc_name: string }>("SELECT t.*, d.name AS doc_name FROM sign_templates t JOIN documents d ON d.id = t.document_id WHERE t.id = ?", l.template_id);
  const ws = get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", l.workspace_id);
  const owner = get<{ name: string }>("SELECT name FROM users WHERE id = ?", l.created_by);
  const pay = workspacePayments(l.workspace_id);
  return json({
    title: l.title,
    message: t?.message ?? "",
    from: ws?.name ?? owner?.name ?? "pdftek",
    sender: owner?.name ?? "",
    pageCount: t?.page_count ?? 1,
    verifyEmail: Boolean(l.verify_email),
    payment: l.payment_cents && pay.ready ? { amount: formatMoney(l.payment_cents, l.payment_currency ?? "usd"), description: l.payment_desc ?? "" } : null,
    closed: linkClosed(l) ?? (t ? null : "This document is no longer available."),
  });
});

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), name: z.string().trim().min(2, "Enter your full name.").max(100), email: z.string().trim().toLowerCase().email("Enter a valid email address.") }),
  z.object({ action: z.literal("verify"), codeId: z.string().max(40), code: z.string().max(12) }),
]);

/**
 * start: with email verification, emails a code; otherwise creates the visitor's envelope.
 * verify: checks the code and creates the envelope. Both answer with the signing address.
 */
export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  rateLimit(`slink:${clientIp(req)}`, 30, 3600_000);
  const l = getLinkBySlug(slug);
  const closed = linkClosed(l);
  if (closed) throw badRequest(closed);
  const input = await body(req, Input);
  if (input.action === "start") {
    rateLimit(`slink:${input.email}`, 10, 3600_000);
    if (l.verify_email) {
      const codeId = await sendLinkCode(l, input.name, input.email);
      return json({ needCode: true, codeId });
    }
    return json(await startFromLink(l, { name: input.name, email: input.email, verified: false }));
  }
  const who = checkLinkCode(l, input.codeId, input.code);
  return json(await startFromLink(l, { ...who, verified: true }));
});
