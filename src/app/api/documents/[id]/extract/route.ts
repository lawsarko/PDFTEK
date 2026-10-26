import { z } from "zod";
import { assertAiCredits, chargeAi } from "@/lib/billing";
import { all, insert, run } from "@/lib/db";
import { id as newId, now } from "@/lib/ids";
import { body, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { docAccess, pageTexts, readCurrentPdf } from "@/lib/documents";
import { EXTRACT_PRESETS, extract } from "@/lib/ai";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  const rows = all<{ id: string; preset: string; title: string; result_json: string; created_at: number }>(
    "SELECT id, preset, title, result_json, created_at FROM extractions WHERE document_id = ? ORDER BY created_at DESC",
    doc.id,
  );
  return json({
    presets: Object.entries(EXTRACT_PRESETS).map(([key, p]) => ({ key, title: p.title })),
    extractions: rows.map((r) => ({ id: r.id, preset: r.preset, title: r.title, result: JSON.parse(r.result_json), createdAt: r.created_at })),
  });
});

const Input = z.object({
  preset: z.string(),
  fields: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  rateLimit(`extract:${ctx.user.id}`, 300, 24 * 3600_000); // abuse guard; cost is metered in credits
  assertAiCredits(ctx);
  const input = await body(req, Input);
  const pdf = await readCurrentPdf(doc);
  const fallbackText = pageTexts(doc.id).map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
  const result = await extract({
    source: { kind: "pdf", title: doc.name, pdf, fallbackText },
    preset: input.preset,
    customFields: input.fields,
    playbook: ctx.workspace.playbook,
    onUsage: (model, usage) => chargeAi(ctx, model, usage, "AI extraction"),
  });
  const title = input.preset === "custom" ? "Custom fields" : EXTRACT_PRESETS[input.preset].title;
  const row = { id: newId("ext_"), document_id: doc.id, preset: input.preset, title, result_json: JSON.stringify(result), created_by: ctx.user.id, created_at: now() };
  insert("extractions", row);
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "extracted", documentId: doc.id, meta: { title } });
  return json({ extraction: { id: row.id, preset: row.preset, title, result, createdAt: row.created_at } });
});

export const DELETE = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  run("DELETE FROM extractions WHERE id = ? AND document_id = ?", new URL(req.url).searchParams.get("extractionId"), doc.id);
  return json({ ok: true });
});
