import { z } from "zod";
import { get, run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route, notFound, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { appUrl, sendMail } from "@/lib/mail";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const r = get<{ id: string; workspace_id: string; title: string; recipient_name: string; recipient_email: string; due_date: string | null; token: string; status: string; message: string }>(
    "SELECT * FROM doc_requests WHERE id = ?",
    id,
  );
  if (!r) throw notFound();
  const ctx = await requireMember(r.workspace_id);
  const { action } = await body(req, z.object({ action: z.enum(["remind", "cancel", "delete"]) }));
  if (action === "delete") {
    run("DELETE FROM doc_requests WHERE id = ?", id);
    return json({ ok: true });
  }
  if (r.status === "complete" || r.status === "cancelled") throw badRequest("This request is already closed.");
  if (action === "cancel") {
    run("UPDATE doc_requests SET status = 'cancelled' WHERE id = ?", id);
    return json({ ok: true });
  }
  const { delivered } = await sendMail({
    to: r.recipient_email,
    subject: `Reminder: ${r.title}`,
    heading: `Friendly reminder from ${ctx.user.name}`,
    paragraphs: [`Hi ${r.recipient_name}, this is a reminder to upload: ${r.title}.`, ...(r.due_date ? [`It's due by ${r.due_date}.`] : [])],
    cta: { label: "Upload securely", url: appUrl(`/request/${r.token}`) },
  });
  run("UPDATE doc_requests SET last_reminded_at = ? WHERE id = ?", now(), id);
  return json({ ok: true, delivered });
});
