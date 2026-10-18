"use client";
import { PDFDocument } from "pdf-lib";

export const isTiffName = (name: string) => /\.tiff?$/i.test(name);

/**
 * Every page of a TIFF as a canvas. Most browsers can't display TIFF, so it's decoded here (utif2);
 * multi-page TIFFs (scans, faxes) give one canvas per page.
 */
export async function tiffPages(blob: Blob): Promise<HTMLCanvasElement[]> {
  const mod = await import("utif2");
  const UTIF = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const buf = await blob.arrayBuffer();
  const ifds = UTIF.decode(buf).filter((ifd) => {
    const sub = ifd.t254 as number[] | undefined;
    return !((sub?.[0] ?? 0) & 1) && ifd.t256 && ifd.t257;
  });
  const pages: HTMLCanvasElement[] = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd);
    if (!ifd.width || !ifd.height) continue;
    const canvas = document.createElement("canvas");
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(ifd.width, ifd.height);
    img.data.set(UTIF.toRGBA8(ifd));
    ctx.putImageData(img, 0, 0);
    pages.push(canvas);
  }
  if (!pages.length) throw new Error("This TIFF file couldn't be read.");
  return pages;
}

/** Decodes any browser-supported image (or a canvas, or a TIFF's first page) and re-encodes it as JPEG (max 2400px on the long edge). */
export async function toJpeg(blob: Blob | HTMLCanvasElement, opts: { enhance?: boolean; maxEdge?: number } = {}): Promise<{ bytes: Uint8Array; width: number; height: number; url: string }> {
  const source: CanvasImageSource & { width: number; height: number } =
    blob instanceof HTMLCanvasElement
      ? blob
      : blob instanceof File && isTiffName(blob.name)
        ? (await tiffPages(blob))[0]
        : await createImageBitmap(blob).catch(() => {
            throw new Error("This image format isn't supported by your browser. Use JPG, PNG, WEBP or TIFF.");
          });
  const bmp = source;
  const max = opts.maxEdge ?? 2400;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * s);
  canvas.height = Math.round(bmp.height * s);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (opts.enhance) enhance(ctx, canvas.width, canvas.height);
  const out = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.88));
  return { bytes: new Uint8Array(await out.arrayBuffer()), width: canvas.width, height: canvas.height, url: URL.createObjectURL(out) };
}

/** Document-scan look: grayscale, auto-levels, mild contrast boost. */
export function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let lo = 255;
  let hi = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[j] = g;
  }
  const hist = new Array(256).fill(0);
  gray.forEach((g) => hist[g]++);
  let acc = 0;
  const total = w * h;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > total * 0.02 && lo === 255) lo = v;
    if (acc > total * 0.9) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((gray[j] - lo) / range) * 255;
    v = v > 200 ? 255 : v < 40 ? v * 0.6 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

export async function imagesToPdf(images: { bytes: Uint8Array; width: number; height: number }[], pageSize: "fit" | "a4" | "letter" = "fit"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const jpg = await doc.embedJpg(im.bytes);
    if (pageSize === "fit") {
      const s = Math.min(1, 842 / Math.max(im.width, im.height));
      const w = im.width * s;
      const h = im.height * s;
      doc.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    } else {
      const [pw, ph] = pageSize === "a4" ? [595.28, 841.89] : [612, 792];
      const landscape = im.width > im.height;
      const [W, H] = landscape ? [ph, pw] : [pw, ph];
      const m = 24;
      const s = Math.min((W - 2 * m) / im.width, (H - 2 * m) / im.height);
      doc.addPage([W, H]).drawImage(jpg, { x: (W - im.width * s) / 2, y: (H - im.height * s) / 2, width: im.width * s, height: im.height * s });
    }
  }
  return doc.save();
}
