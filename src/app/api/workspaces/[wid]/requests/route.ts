import { z } from "zod";
import { all, insert } from "@/lib/db";
import { id, now, token } from "@/lib/ids";
import { body, json, route } from "@/lib/http";
import { requireMember, requirePlan } from "@/lib/auth";
import { appUrl, sendMail } from "@/lib/mail";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const rows = all<Record<string, unknown>>(
    `SELECT r.id, r.title, r.message, r.recipient_name AS recipientName, r.recipient_email AS recipientEmail, r.due_date AS dueDate,
            r.status, r.document_id AS documentId, r.created_at AS createdAt, r.viewed_at AS viewedAt, r.completed_at AS completedAt,
            r.token, u.name AS createdBy
       FROM doc_requests r JOIN users u ON u.id = r.created_by
      WHERE r.workspace_id = ? ORDER BY CASE r.status WHEN 'complete' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END, r.created_at DESC LIMIT 200`,
    wid,
  );
  return json({ requests: rows.map((r) => ({ ...r, link: appUrl(`/request/${r.token}`), token: undefined })) });
});

const Input = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).default(""),
  recipientName: z.string().trim().min(1).max(100),
  recipientEmail: z.string().trim().toLowerCase().email(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  requirePlan(ctx, "Document requests");
  const input = await body(req, Input);
  const t = token();
  const rid = id("req_");
  insert("doc_requests", {
    id: rid,
    workspace_id: wid,
    title: input.title,
    message: input.message,
    recipient_name: input.recipientName,
    recipient_email: input.recipientEmail,
    due_date: input.dueDate ?? null,
    token: t,
    status: "pending",
    created_by: ctx.user.id,
    created_at: now(),
  });
  const link = appUrl(`/request/${t}`);
  const { delivered } = await sendMail({
    to: input.recipientEmail,
    subject: `${ctx.user.name} (${ctx.workspace.name}) requested: ${input.title}`,
    heading: `${ctx.user.name} requested a document`,
    paragraphs: [
      `Hi ${input.recipientName}, ${ctx.user.name} at ${ctx.workspace.name} asked you to upload: ${input.title}.`,
      ...(input.message ? [input.message] : []),
      ...(input.dueDate ? [`Due by ${input.dueDate}.`] : []),
    ],
    cta: { label: "Upload securely", url: link },
  });
  logActivity({ workspaceId: wid, userId: ctx.user.id, action: "requested_document", meta: { title: input.title, from: input.recipientName } });
  return json({ id: rid, link, delivered });
});
