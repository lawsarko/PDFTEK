import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { removeFile, updateFile } from "@/lib/clients";

type P = { params: Promise<{ wid: string; cid: string; fid: string }> };

export const PATCH = route<P>(async (req, { params }) => {
  const { wid, fid } = await params;
  const ctx = await firmCtx(wid);
  const input = await body(
    req,
    z.object({ shared: z.boolean().optional(), year: z.number().int().nullable().optional(), category: z.string().max(120).optional(), payCents: z.number().int().min(0).max(10_000_000).nullable().optional(), payDescription: z.string().max(200).optional() }),
  );
  updateFile(ctx, fid, input);
  return json({ ok: true });
});

/** Takes the file out of the client's folder (the document stays in the library). */
export const DELETE = route<P>(async (_req, { params }) => {
  const { wid, fid } = await params;
  removeFile(await firmCtx(wid), fid);
  return json({ ok: true });
});
