import { z } from "zod";
import { body, clientIp, json, route } from "@/lib/http";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { logActivity } from "@/lib/activity";
import { cachedResult, finAi, readInvoices, readStatement, saveResult } from "@/lib/fin-extract";

type P = { params: Promise<{ id: string }> };

/**
 * Reads a bank statement or invoice PDF into rows. Results are kept per document version, so
 * reading the same file again (or downloading it in another format) costs nothing.
 */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { kind, refresh } = await body(req, z.object({ kind: z.enum(["statement", "invoice"]), refresh: z.boolean().optional() }));
  const { ctx, doc } = await docAccess(id);
  if (!refresh) {
    const hit = cachedResult(doc, kind);
    if (hit) return json({ result: hit, cached: true });
  }
  const onUsage = finAi(ctx, doc, clientIp(req));
  const pdf = new Uint8Array(await readCurrentPdf(doc));
  const result = kind === "statement" ? await readStatement(pdf, onUsage) : await readInvoices(pdf, onUsage);
  saveResult(doc, kind, result);
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "converted", documentId: doc.id, meta: { to: kind === "statement" ? "statement-xlsx" : "invoice-xlsx" } });
  return json({ result, cached: false });
});
