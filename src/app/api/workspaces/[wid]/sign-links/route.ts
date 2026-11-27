import { z } from "zod";
import { all, insert } from "@/lib/db";
import { id, now, token } from "@/lib/ids";
import { badRequest, body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { requireMembership } from "@/lib/billing";
import { getLinkBySlug, getTemplate, linkDTO, roles, workspacePayments, type LinkRow } from "@/lib/esign";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ wid: string }> };

const Person = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email() });

const Input = z.object({
  templateId: z.string(),
  title: z.string().trim().min(1).max(200),
  roleKey: z.string().max(40),
  others: z.record(z.string(), Person).default({}),
  verifyEmail: z.boolean().default(true),
  payment: z
    .object({
      amount: z.number().min(0.5, "The minimum payment is 0.50.").max(100000),
      currency: z.enum(["usd", "eur", "gbp", "cad", "aud", "ngn", "zar", "kes", "ghs", "inr", "mxn", "brl"]).default("usd"),
      description: z.string().trim().max(200).default(""),
    })
    .nullable()
    .optional(),
  maxUses: z.number().int().min(1).max(100000).nullable().optional(),
  expiresAt: z.number().int().nullable().optional(),
});

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const rows = all<LinkRow>("SELECT * FROM sign_links WHERE workspace_id = ? ORDER BY created_at DESC", wid);
  return json({ links: rows.map(linkDTO), payments: workspacePayments(wid) });
});

/** Creates a public signing link: anyone who opens it signs their own copy of the template. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  requireMembership(ctx, "Signing links");
  const input = await body(req, Input);
  const t = getTemplate(wid, input.templateId);
  const r = roles(t);
  if (!r.some((x) => x.key === input.roleKey)) throw badRequest("Choose which role the people using the link will sign as.");
  const fixed: Record<string, { name: string; email: string }> = {};
  for (const role of r) {
    if (role.key === input.roleKey) continue;
    const p = input.others[role.key] ?? (role.name && role.email ? { name: role.name, email: role.email } : null);
    if (!p) throw badRequest(`Enter who countersigns as ${role.label}.`);
    fixed[role.key] = p;
  }
  if (input.payment) {
    const pay = workspacePayments(wid);
    if (!pay.available) throw badRequest("Payments aren't available on this server.");
    if (!pay.ready) throw badRequest("Connect a Stripe account first (Settings → Integrations → Payments) to collect payments.");
  }
  if (input.expiresAt && input.expiresAt < now()) throw badRequest("Choose an expiry date in the future.");
  // Short, unguessable address: /s/<slug>
  let slug = token(9);
  while ((() => { try { getLinkBySlug(slug); return true; } catch { return false; } })()) slug = token(9);
  const lid = id("slk_");
  insert("sign_links", {
    id: lid,
    workspace_id: wid,
    template_id: t.id,
    slug,
    title: input.title,
    role_key: input.roleKey,
    fixed_json: JSON.stringify(fixed),
    verify_email: input.verifyEmail ? 1 : 0,
    payment_cents: input.payment ? Math.round(input.payment.amount * 100) : null,
    payment_currency: input.payment?.currency ?? null,
    payment_desc: input.payment ? input.payment.description || input.title : null,
    max_uses: input.maxUses ?? null,
    expires_at: input.expiresAt ?? null,
    active: 1,
    created_by: ctx.user.id,
    created_at: now(),
  });
  logActivity({ workspaceId: wid, userId: ctx.user.id, action: "signing_link_created", documentId: t.document_id, meta: { title: input.title } });
  return json({ link: linkDTO(getLinkBySlug(slug)) });
});
