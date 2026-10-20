import { z } from "zod";
import { all } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { requireMembership } from "@/lib/billing";
import { createRequest, requestSummary, type RequestRow } from "@/lib/requests";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const rows = all<RequestRow>(
    `SELECT * FROM doc_requests WHERE workspace_id = ?
      ORDER BY CASE status WHEN 'complete' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END, created_at DESC LIMIT 200`,
    wid,
  );
  return json({ requests: rows.map(requestSummary) });
});

const Accept = z.enum(["any", "pdf", "image", "office"]);
const Input = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).default(""),
  recipientName: z.string().trim().min(1).max(100),
  recipientEmail: z.string().trim().toLowerCase().email(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  items: z
    .array(z.object({ label: z.string().trim().min(1).max(200), note: z.string().trim().max(300).optional(), required: z.boolean().optional(), accept: Accept.optional() }))
    .max(25)
    .default([]),
  verify: z.enum(["none", "email", "code"]).default("none"),
  expiresInDays: z.number().int().min(1).max(365).default(30),
  autoRemind: z.boolean().default(false),
  packet: z.boolean().default(false),
});

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  requireMembership(ctx, "Document requests");
  const input = await body(req, Input);
  return json(await createRequest(ctx, input));
});
