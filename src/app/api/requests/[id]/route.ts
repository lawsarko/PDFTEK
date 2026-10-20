import { z } from "zod";
import { get, run } from "@/lib/db";
import { body, json, route, notFound } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { extend, logEvent, remind, requestDetail, returnItem, rotateAccessCode, type RequestRow } from "@/lib/requests";

type P = { params: Promise<{ id: string }> };

async function load(id: string) {
  const r = get<RequestRow>("SELECT * FROM doc_requests WHERE id = ?", id);
  if (!r) throw notFound();
  const ctx = await requireMember(r.workspace_id);
  return { r, ctx };
}

export const GET = route<P>(async (_req, { params }) => {
  const { r } = await load((await params).id);
  return json({ request: requestDetail(r) });
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remind") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("return"), itemId: z.string(), feedback: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal("new_code") }),
]);

export const POST = route<P>(async (req, { params }) => {
  const { r } = await load((await params).id);
  const input = await body(req, Action);
  switch (input.action) {
    case "delete":
      run("DELETE FROM doc_requests WHERE id = ?", r.id);
      return json({ ok: true });
    case "cancel":
      run("UPDATE doc_requests SET status = 'cancelled' WHERE id = ?", r.id);
      run("DELETE FROM doc_request_sessions WHERE request_id = ?", r.id);
      logEvent(r.id, "cancelled");
      return json({ ok: true });
    case "remind":
      return json({ ok: true, delivered: await remind(r) });
    case "return":
      return json({ ok: true, delivered: await returnItem(r, input.itemId, input.feedback) });
    case "extend":
      extend(r, input.days);
      return json({ ok: true });
    case "new_code":
      return json({ ok: true, accessCode: rotateAccessCode(r) });
  }
});
