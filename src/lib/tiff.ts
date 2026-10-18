import "server-only";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

/**
 * TIFF → PDF, on the server, so it works whatever browser uploaded it (most can't display TIFF).
 * Every page of a multi-page TIFF (faxes, scanner output) becomes a PDF page, sized from the scan's
 * resolution so an A4 scan comes out A4. Black-and-white scans are kept lossless (PNG); colour and
 * grey pages are stored as high-quality JPEG to keep the PDF small.
 */

const MAX_PIXELS = 60_000_000; // per page; larger pages are scaled down to stay within memory

type IFD = { [k: string]: unknown; width: number; height: number; data: Uint8Array };

const num = (v: unknown, i = 0): number | undefined => (Array.isArray(v) || ArrayBuffer.isView(v) ? Number((v as ArrayLike<number>)[i]) : typeof v === "number" ? v : undefined);

/** Dots per inch from the TIFF's resolution tags (72 when the file doesn't say). */
function dpi(ifd: IFD, tag: "t282" | "t283"): number {
  // Rationals come as [[300, 1]] (utif2), [300, 1] or a plain number.
  let v = ifd[tag];
  if (Array.isArray(v) && Array.isArray(v[0])) v = v[0];
  let r = Array.isArray(v) ? (v.length >= 2 ? Number(v[0]) / Number(v[1] || 1) : Number(v[0])) : (num(v) ?? 0);
  const unit = num(ifd.t296) ?? 2; // 2 = inch, 3 = centimetre
  if (unit === 3) r *= 2.54;
  return r >= 30 && r <= 2400 ? r : 0;
}

export async function tiffToPdf(data: Uint8Array): Promise<Buffer> {
  const UTIF = (await import("utif2")).default ?? (await import("utif2"));
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const ifds = (UTIF.decode(buf) as unknown as IFD[]).filter((ifd) => ((num(ifd.t254) ?? 0) & 1) === 0 && ifd.t256 && ifd.t257);
  if (!ifds.length) throw new Error("No images found in this TIFF file.");
  const doc = await PDFDocument.create();
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd as never);
    const w = ifd.width;
    const h = ifd.height;
    if (!w || !h) continue;
    const rgba = UTIF.toRGBA8(ifd as never);
    // Bilevel (1-bit) scans: lossless PNG keeps text sharp and small.
    const bilevel = (num(ifd.t258) ?? 8) === 1;
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
    const src = createCanvas(w, h);
    const sctx = src.getContext("2d");
    const imageData = sctx.createImageData(w, h);
    imageData.data.set(rgba);
    sctx.putImageData(imageData, 0, 0);
    let canvas = src;
    if (scale < 1) {
      canvas = createCanvas(Math.round(w * scale), Math.round(h * scale));
      canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
    }
    // Transparent areas become white, as on paper.
    const flat = createCanvas(canvas.width, canvas.height);
    const fctx = flat.getContext("2d");
    fctx.fillStyle = "#ffffff";
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    const img = bilevel ? await doc.embedPng(flat.toBuffer("image/png")) : await doc.embedJpg(flat.toBuffer("image/jpeg", 90));
    // Page size from the scan resolution; without one, fit the image to about a page.
    const dx = dpi(ifd, "t282");
    const dy = dpi(ifd, "t283") || dx;
    let pw: number;
    let ph: number;
    if (dx && dy) {
      pw = (w / dx) * 72;
      ph = (h / dy) * 72;
    } else {
      const s = Math.min(1, 1200 / Math.max(w, h));
      pw = w * s;
      ph = h * s;
    }
    const page = doc.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  }
  if (!doc.getPageCount()) throw new Error("This TIFF file couldn't be read.");
  return Buffer.from(await doc.save());
}
