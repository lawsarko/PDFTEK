import { z } from "zod";
import { all, get, run, tx } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, clientIp, json, route, notFound, badRequest, conflict } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { finalizeSignature, inviteSigner, type FieldRow, type SignatureRequestRow, type SignerRow } from "@/lib/signing";
import { logActivity, notify } from "@/lib/activity";

type P = { params: Promise<{ token: string }> };

function load(token: string) {
  const signer = get<SignerRow>("SELECT * FROM signers WHERE token = ?", token);
  if (!signer) throw notFound("This signing link is invalid.");
  const req = get<SignatureRequestRow & { doc_name: string; sender: string; workspace_name: string; page_count: number }>(
    `SELECT r.*, d.name AS doc_name, u.name AS sender, w.name AS workspace_name, v.page_count
       FROM signature_requests r JOIN documents d ON d.id = r.document_id JOIN users u ON u.id = r.created_by
       JOIN workspaces w ON w.id = r.workspace_id JOIN document_versions v ON v.id = r.version_id WHERE r.id = ?`,
    signer.request_id,
  )!;
  return { signer, req };
}

function blockedBy(req: SignatureRequestRow, signer: SignerRow): string | null {
  if (!req.sequential) return null;
  const before = get<{ name: string }>(
    "SELECT name FROM signers WHERE request_id = ? AND order_index < ? AND status != 'signed' ORDER BY order_index LIMIT 1",
    req.id,
    signer.order_index,
  );
  return before?.name ?? null;
}

export const GET = route<P>(async (_req, { params }) => {
  const { token } = await params;
  const { signer, req } = load(token);
  if (!signer.viewed_at && req.status === "sent") {
    run("UPDATE signers SET viewed_at = ?, status = CASE status WHEN 'pending' THEN 'viewed' ELSE status END WHERE id = ?", now(), signer.id);
  }
  const fields = all<FieldRow>("SELECT * FROM signature_fields WHERE request_id = ? AND signer_id = ?", req.id, signer.id);
  const others = all<{ name: string; status: string }>("SELECT name, status FROM signers WHERE request_id = ? ORDER BY order_index", req.id);
  return json({
    title: req.title,
    message: req.message,
    documentName: req.doc_name,
    sender: req.sender,
    workspaceName: req.workspace_name,
    pageCount: req.page_count,
    requestStatus: req.status,
    signer: { name: signer.name, email: signer.email, status: signer.status === "pending" ? "viewed" : signer.status },
    waitingFor: blockedBy(req, signer),
    signers: others,
    fields: fields.map((f) => ({ id: f.id, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, kind: f.kind })),
  });
});

const Input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sign"),
    consent: z.literal(true),
    signaturePng: z.string().startsWith("data:image/png;base64,").max(600_000),
    initialsPng: z.string().startsWith("data:image/png;base64,").max(300_000).optional(),
    values: z.record(z.string(), z.string().max(500)).default({}),
  }),
  z.object({ action: z.literal("decline"), reason: z.string().trim().min(1).max(1000) }),
]);

export const POST = route<P>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`sign:${clientIp(req)}`, 30, 3600_000);
  const { signer, req: env } = load(token);
  if (env.status !== "sent") throw badRequest(env.status === "completed" ? "This document is already fully signed." : "This signing request is no longer active.");
  if (signer.status === "signed") throw conflict("You've already signed this document.");
  if (signer.status === "declined") throw conflict("You declined this request.");
  const waiting = blockedBy(env, signer);
  if (waiting) throw badRequest(`Waiting for ${waiting} to sign first.`);
  const input = await body(req, Input);

  if (input.action === "decline") {
    tx(() => {
      run("UPDATE signers SET status = 'declined', decline_reason = ? WHERE id = ?", input.reason, signer.id);
      run("UPDATE signature_requests SET status = 'declined' WHERE id = ?", env.id);
    });
    logActivity({ workspaceId: env.workspace_id, actorLabel: signer.name, action: "declined_signature", documentId: env.document_id, meta: { title: env.title, reason: input.reason } });
    notify({ userId: env.created_by, workspaceId: env.workspace_id, title: `${signer.name} declined to sign ${env.title}`, body: input.reason, link: `/app/${env.workspace_id}?doc=${env.document_id}` });
    return json({ ok: true, status: "declined" });
  }

  const fields = all<FieldRow>("SELECT * FROM signature_fields WHERE request_id = ? AND signer_id = ?", env.id, signer.id);
  for (const f of fields) {
    if (f.kind === "text" && !input.values[f.id]?.trim()) throw badRequest("Fill in every text field before signing.");
  }
  tx(() => {
    for (const f of fields) {
      if (f.kind === "text") run("UPDATE signature_fields SET value = ? WHERE id = ?", input.values[f.id].trim(), f.id);
      if (f.kind === "initials" && input.initialsPng) run("UPDATE signature_fields SET value = ? WHERE id = ?", input.initialsPng, f.id);
    }
    run(
      "UPDATE signers SET status = 'signed', signed_at = ?, ip = ?, user_agent = ?, signature_png = ? WHERE id = ?",
      now(),
      clientIp(req),
      req.headers.get("user-agent")?.slice(0, 300) ?? null,
      input.signaturePng,
      signer.id,
    );
  });
  logActivity({ workspaceId: env.workspace_id, actorLabel: signer.name, action: "signed", documentId: env.document_id, meta: { title: env.title } });
  notify({ userId: env.created_by, workspaceId: env.workspace_id, title: `${signer.name} signed ${env.title}`, link: `/app/${env.workspace_id}?doc=${env.document_id}` });

  const remaining = all<SignerRow>("SELECT * FROM signers WHERE request_id = ? AND status != 'signed' ORDER BY order_index", env.id);
  if (!remaining.length) {
    await finalizeSignature(get<SignatureRequestRow>("SELECT * FROM signature_requests WHERE id = ?", env.id)!);
    return json({ ok: true, status: "completed" });
  }
  if (env.sequential) await inviteSigner(env, remaining[0], env.sender);
  return json({ ok: true, status: "signed" });
});
