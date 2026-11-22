import { z } from "zod";
import { get, insert, run } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { badRequest, body, json, notFound, route } from "@/lib/http";
import { rateLimit, requireMember } from "@/lib/auth";
import { requireMembership, tierOf } from "@/lib/billing";
import { createEnvelope, getTemplate, roles, type EnvelopeSigner } from "@/lib/esign";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

const Person = z.object({ name: z.string().trim().min(1, "Enter a name for every signer.").max(100), email: z.string().trim().toLowerCase().email("Enter a valid email for every signer.") });

const Input = z.discriminatedUnion("mode", [
  // One envelope: a person for each role.
  z.object({
    mode: z.literal("single"),
    people: z.record(z.string(), Person),
    title: z.string().trim().min(1).max(200).optional(),
    message: z.string().max(2000).optional(),
  }),
  // Bulk send: one envelope per spreadsheet row for `roleKey`; other roles are the same people each time.
  z.object({
    mode: z.literal("bulk"),
    roleKey: z.string().max(40),
    rows: z.array(Person).min(1).max(500),
    others: z.record(z.string(), Person).default({}),
    title: z.string().trim().min(1).max(200).optional(),
    message: z.string().max(2000).optional(),
  }),
]);

/** Bulk sends per batch: Team can send more at once than Day Pass / Pro. */
const BULK_LIMIT: Record<string, number> = { team: 500, admin: 500, pro: 200, pass: 100 };

export const POST = route<P>(async (req, { params }) => {
  const { id: templateId } = await params;
  const row = get<{ workspace_id: string }>("SELECT workspace_id FROM sign_templates WHERE id = ?", templateId);
  if (!row) throw notFound("Template not found.");
  const ctx = await requireMember(row.workspace_id);
  requireMembership(ctx, "Sending from templates");
  const t = getTemplate(row.workspace_id, templateId);
  const doc = get<{ id: string }>("SELECT id FROM documents WHERE id = ?", t.document_id);
  if (!doc) throw badRequest("This template's document was deleted. Create the template again from a document in your library.");
  const input = await body(req, Input);
  const r = roles(t);
  const title = input.title || t.title;
  const message = input.message ?? t.message;

  if (input.mode === "single") {
    rateLimit(`tsend:${ctx.user.id}`, 60, 3600_000);
    const signers: EnvelopeSigner[] = r.map((role) => {
      const p = input.people[role.key] ?? (role.name && role.email ? { name: role.name, email: role.email } : null);
      if (!p) throw badRequest(`Enter the name and email for ${role.label}.`);
      return { key: role.key, name: p.name, email: p.email };
    });
    const env = await createEnvelope({ template: t, createdBy: ctx.user.id, senderName: ctx.user.name, title, message, sequential: Boolean(t.sequential), signers, invite: "auto" });
    logActivity({ workspaceId: t.workspace_id, userId: ctx.user.id, action: "sent_for_signature", documentId: t.document_id, meta: { title, signers: signers.length, template: t.name } });
    return json({ id: env.id, delivered: env.delivered, links: env.signers.map((s) => ({ name: s.name, email: s.email, link: `/sign/${s.token}` })) });
  }

  // ---- bulk ----
  const limit = BULK_LIMIT[tierOf(ctx)] ?? 100;
  if (input.rows.length > limit) throw badRequest(`Your plan sends up to ${limit} envelopes at a time. Split the list, or upgrade to Team for up to 500.`);
  if (!r.some((x) => x.key === input.roleKey)) throw badRequest("Choose which role the spreadsheet fills.");
  const fixed: Record<string, { name: string; email: string }> = {};
  for (const role of r) {
    if (role.key === input.roleKey) continue;
    const p = input.others[role.key] ?? (role.name && role.email ? { name: role.name, email: role.email } : null);
    if (!p) throw badRequest(`Enter the name and email for ${role.label}.`);
    fixed[role.key] = p;
  }
  const seen = new Set<string>();
  const rows = input.rows.filter((p) => !seen.has(p.email) && seen.add(p.email));
  const batchId = id("sbt_");
  insert("sign_batches", { id: batchId, workspace_id: t.workspace_id, template_id: t.id, title, total: rows.length, sent: 0, created_by: ctx.user.id, created_at: now() });
  let sent = 0;
  let delivered = 0;
  const failed: { email: string; error: string }[] = [];
  for (const p of rows) {
    try {
      const signers: EnvelopeSigner[] = r.map((role) => (role.key === input.roleKey ? { key: role.key, name: p.name, email: p.email } : { key: role.key, ...fixed[role.key] }));
      const env = await createEnvelope({
        template: t,
        createdBy: ctx.user.id,
        senderName: ctx.user.name,
        title: `${title} — ${p.name}`,
        message,
        sequential: Boolean(t.sequential),
        signers,
        batchId,
        invite: "auto",
      });
      sent++;
      delivered += env.delivered;
    } catch (e) {
      failed.push({ email: p.email, error: e instanceof Error ? e.message : "Couldn't send." });
    }
  }
  run("UPDATE sign_batches SET sent = ? WHERE id = ?", sent, batchId);
  logActivity({ workspaceId: t.workspace_id, userId: ctx.user.id, action: "bulk_sent", documentId: t.document_id, meta: { title, envelopes: sent, template: t.name } });
  return json({ batchId, sent, delivered, skipped: input.rows.length - rows.length, failed });
});
