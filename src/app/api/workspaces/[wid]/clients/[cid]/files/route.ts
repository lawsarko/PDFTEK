import { badRequest, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { attachFile, getClient, shareFile } from "@/lib/clients";
import { taxSummaryXlsx } from "@/lib/client-ai";
import { assertFileSize } from "@/lib/billing";

type P = { params: Promise<{ wid: string; cid: string }> };

/** The firm adds a document to the client's folder: a new upload, or one already in the library. */
export const POST = route<P>(async (req, { params }) => {
  const { wid, cid } = await params;
  const ctx = await firmCtx(wid);
  const form = await req.formData();
  const year = Number(form.get("year")) || null;
  const category = String(form.get("category") ?? "").slice(0, 120);
  const pay = Math.round(Number(form.get("payAmount") ?? 0) * 100);
  const payCents = Number.isFinite(pay) && pay >= 50 ? Math.min(pay, 10_000_000) : null;
  const opts = { year, category, payCents, payDescription: String(form.get("payDescription") ?? ""), shared: form.get("shared") !== "0", notify: form.get("notify") !== "0" };
  const existing = form.get("documentId");
  if (typeof existing === "string" && existing) return json({ id: await attachFile(ctx, getClient(wid, cid), existing, opts) });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a file.");
  assertFileSize(ctx, file.size, file.name);
  return json({ id: await shareFile(ctx, cid, { name: file.name, data: Buffer.from(await file.arrayBuffer()) }, opts) });
});

/** The year's summary spreadsheet (amounts read from the client's documents). */
export const GET = route<P>(async (req, { params }) => {
  const { wid, cid } = await params;
  const ctx = await firmCtx(wid, { write: false });
  const year = Number(new URL(req.url).searchParams.get("year"));
  if (!year) throw badRequest("Choose a year.");
  const { data, filename } = await taxSummaryXlsx(ctx, cid, year);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});
