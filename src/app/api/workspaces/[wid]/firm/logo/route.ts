import sharp from "sharp";
import { run } from "@/lib/db";
import { badRequest, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { putFile } from "@/lib/storage";

type P = { params: Promise<{ wid: string }> };

/** The firm's logo for the portal and emails: resized to a crisp PNG, at most 600×200. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await firmCtx(wid, { role: "admin" });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw badRequest("Choose an image.");
  if (file.size > 5 * 1024 * 1024) throw badRequest("Use an image under 5 MB.");
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer())).resize({ width: 600, height: 200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw badRequest("That file isn't an image we can read. Use PNG, JPG, SVG or WebP.");
  }
  const key = await putFile(wid, png, "png");
  run("UPDATE workspaces SET brand_logo_key = ? WHERE id = ?", key, wid);
  return json({ ok: true });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await firmCtx(wid, { role: "admin" });
  run("UPDATE workspaces SET brand_logo_key = NULL WHERE id = ?", wid);
  return json({ ok: true });
});
