import { z } from "zod";
import { all, insert, tx } from "@/lib/db";
import { id, now, token } from "@/lib/ids";
import { body, json, route, badRequest } from "@/lib/http";
import { requireMember, requirePlan } from "@/lib/auth";
import { getDocument } from "@/lib/documents";
import { inviteSigner, type SignatureRequestRow, type SignerRow } from "@/lib/signing";
import { logActivity } from "@/lib/activity";
import { appUrl } from "@/lib/mail";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const docId = new URL(req.url).searchParams.get("doc");
  const reqs = all<SignatureRequestRow & { doc_name: string; sender: string }>(
    `SELECT r.*, d.name AS doc_name, u.name AS sender FROM signature_requests r
       JOIN documents d ON d.id = r.document_id JOIN users u ON u.id = r.created_by
      WHERE r.workspace_id = ? ${docId ? "AND r.document_id = ?" : ""} ORDER BY r.created_at DESC LIMIT 200`,
    ...(docId ? [wid, docId] : [wid]),
  );
  const out = reqs.map((r) => {
    const signers = all<SignerRow>("SELECT * FROM signers WHERE request_id = ? ORDER BY order_index", r.id);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      documentId: r.document_id,
      documentName: r.doc_name,
      sender: r.sender,
      sequential: Boolean(r.sequential),
      createdAt: r.created_at,
      completedAt: r.completed_at,
      signedVersionId: r.signed_version_id,
      signers: signers.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        signedAt: s.signed_at,
        viewedAt: s.viewed_at,
        declineReason: s.decline_reason,
        link: appUrl(`/sign/${s.token}`),
      })),
    };
  });
  return json({ requests: out });
});

const Input = z.object({
  documentId: z.string(),
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).default(""),
  sequential: z.boolean().default(false),
  signers: z
    .array(z.object({ key: z.string().max(40), name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email() }))
    .min(1)
    .max(20),
  fields: z
    .array(
      z.object({
        signerKey: z.string().max(40),
        page: z.number().int().min(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0.01).max(1),
        h: z.number().min(0.005).max(1),
        kind: z.enum(["signature", "initials", "date", "name", "text"]),
      }),
    )
    .max(500),
});

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  requirePlan(ctx, "E-signatures");
  const input = await body(req, Input);
  const doc = getDocument(ctx, input.documentId);
  const keys = new Set(input.signers.map((s) => s.key));
  if (keys.size !== input.signers.length) throw badRequest("Each signer needs a unique key.");
  if (new Set(input.signers.map((s) => s.email)).size !== input.signers.length) throw badRequest("Each signer needs a different email address.");
  for (const s of input.signers) {
    if (!input.fields.some((f) => f.signerKey === s.key && f.kind === "signature")) throw badRequest(`Place at least one signature field for ${s.name}.`);
  }
  if (input.fields.some((f) => !keys.has(f.signerKey) || f.page > doc.page_count)) throw badRequest("A field references an unknown signer or page.");

  const rid = id("sig_");
  const signerIds: Record<string, string> = {};
  tx(() => {
    insert("signature_requests", {
      id: rid,
      workspace_id: wid,
      document_id: doc.id,
      version_id: doc.current_version_id,
      title: input.title,
      message: input.message,
      status: "sent",
      sequential: input.sequential ? 1 : 0,
      created_by: ctx.user.id,
      created_at: now(),
      sent_at: now(),
    });
    input.signers.forEach((s, i) => {
      signerIds[s.key] = id("sgn_");
      insert("signers", { id: signerIds[s.key], request_id: rid, name: s.name, email: s.email, order_index: i, token: token(), status: "pending" });
    });
    for (const f of input.fields) {
      insert("signature_fields", { id: id("fld_"), request_id: rid, signer_id: signerIds[f.signerKey], page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, kind: f.kind });
    }
  });

  const reqRow = { id: rid, title: input.title, message: input.message } as SignatureRequestRow;
  const signers = all<SignerRow>("SELECT * FROM signers WHERE request_id = ? ORDER BY order_index", rid);
  const toInvite = input.sequential ? signers.slice(0, 1) : signers;
  let delivered = 0;
  for (const s of toInvite) if ((await inviteSigner(reqRow, s, ctx.user.name)).delivered) delivered++;
  logActivity({ workspaceId: wid, userId: ctx.user.id, action: "sent_for_signature", documentId: doc.id, meta: { title: input.title, signers: signers.length } });
  return json({ id: rid, delivered, links: signers.map((s) => ({ name: s.name, email: s.email, link: appUrl(`/sign/${s.token}`) })) });
});
