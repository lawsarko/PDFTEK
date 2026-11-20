import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { docAccess, saveOcrText } from "@/lib/documents";
import { logActivity } from "@/lib/activity";
import { metered } from "@/lib/billing";

type P = { params: Promise<{ id: string }> };

const Input = z.object({ pages: z.array(z.object({ page: z.number().int().min(1), text: z.string().max(200_000) })).max(2000) });

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const { pages } = await body(req, Input);
  await metered(ctx, req, "OCR", async () => saveOcrText(doc.id, ctx.workspace.id, pages.filter((p) => p.page <= doc.page_count)));
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "ocr", documentId: doc.id, meta: { pages: pages.length } });
  return json({ ok: true });
});
