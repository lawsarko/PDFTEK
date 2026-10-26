import { z } from "zod";
import { all, get, run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route, notFound, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { inviteSigner, type SignatureRequestRow, type SignerRow } from "@/lib/signing";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const r = get<SignatureRequestRow>("SELECT * FROM signature_requests WHERE id = ?", id);
  if (!r) throw notFound();
  const ctx = await requireMember(r.workspace_id);
  const { action } = await body(req, z.object({ action: z.enum(["remind", "cancel"]) }));
  if (r.status !== "sent") throw badRequest("This envelope is no longer active.");
  if (action === "cancel") {
    run("UPDATE signature_requests SET status = 'cancelled' WHERE id = ?", id);
    logActivity({ workspaceId: r.workspace_id, userId: ctx.user.id, action: "cancelled_signature", documentId: r.document_id, meta: { title: r.title } });
    return json({ ok: true });
  }
  const pending = all<SignerRow>("SELECT * FROM signers WHERE request_id = ? AND status IN ('pending','viewed') ORDER BY order_index", id);
  const targets = r.sequential ? pending.slice(0, 1) : pending;
  let delivered = 0;
  for (const s of targets) {
    if ((await inviteSigner(r, s, ctx.user.name, true)).delivered) delivered++;
    run("UPDATE signers SET last_reminded_at = ? WHERE id = ?", now(), s.id);
  }
  return json({ ok: true, reminded: targets.length, delivered });
});
