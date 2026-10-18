import "server-only";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

/**
 * TIFF → PDF, on the server, so it works whatever browser uploaded it (most can't display TIFF).
 * Every page of a multi-page TIFF (faxes, scanner output) becomes a PDF page, sized from the scan's
 * resolution so an A4 scan comes out A4.
 *
 * Memory and time matter: a 2 MB compressed scan can be hundreds of MB once decoded, and a
 * request that runs too long or too large is cut off (a 502). So pages are done one at a time,
 * very large pages are reduced to ~16 megapixels (about 400 dpi on A4, plenty for documents), and
 * black-and-white pages stay black-and-white. sharp (libvips) does the decoding: it streams and
 * reads fax (CCITT G4) pages in well under a second. The pure-JavaScript decoder below is the
 * fallback if sharp isn't available.
 */

const MAX_PIXELS = 16_000_000;

type IFD = { [k: string]: unknown; width: number; height: number; data: Uint8Array | null };

const first = (v: unknown): number | undefined => {
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const x = (v as ArrayLike<unknown>)[0];
    return Array.isArray(x) ? Number(x[0]) : Number(x);
  }
  return typeof v === "number" ? v : undefined;
};

/** Dots per inch from the TIFF's resolution tags (0 when the file doesn't say). */
function dpi(ifd: IFD, tag: "t282" | "t283"): number {
  // Rationals come as [[300, 1]] (utif2), [300, 1] or a plain number.
  let v = ifd[tag];
  if (Array.isArray(v) && Array.isArray(v[0])) v = v[0];
  let r = Array.isArray(v) ? (v.length >= 2 ? Number(v[0]) / Number(v[1] || 1) : Number(v[0])) : (first(v) ?? 0);
  if ((first(ifd.t296) ?? 2) === 3) r *= 2.54; // resolution in centimetres
  return r >= 30 && r <= 2400 ? r : 0;
}

/** Reduction factor so a page stays under MAX_PIXELS. */
const factorFor = (w: number, h: number) => Math.max(1, Math.ceil(Math.sqrt((w * h) / MAX_PIXELS)));

/** Black-and-white page straight from its 1-bit rows to gray pixels, averaging f×f blocks. */
function bilevelToRgba(data: Uint8Array, w: number, h: number, blackIsOne: boolean, f: number) {
  const bpl = Math.ceil(w / 8);
  const ow = Math.ceil(w / f);
  const oh = Math.ceil(h / f);
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = oy * f;
    const y1 = Math.min(h, y0 + f);
    for (let ox = 0; ox < ow; ox++) {
      const x0 = ox * f;
      const x1 = Math.min(w, x0 + f);
      let ones = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * bpl;
        for (let x = x0; x < x1; x++) ones += (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
      }
      const n = (y1 - y0) * (x1 - x0);
      const white = blackIsOne ? n - ones : ones;
      const g = Math.round((white / n) * 255);
      const q = (oy * ow + ox) * 4;
      out[q] = out[q + 1] = out[q + 2] = g;
      out[q + 3] = 255;
    }
  }
  return { rgba: out, w: ow, h: oh };
}

/** Colour/gray page: flatten transparency onto white and average f×f blocks. */
function reduceRgba(src: Uint8Array, w: number, h: number, f: number) {
  if (f === 1) {
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (a === 255) continue;
      const k = a / 255;
      src[i] = src[i] * k + 255 * (1 - k);
      src[i + 1] = src[i + 1] * k + 255 * (1 - k);
      src[i + 2] = src[i + 2] * k + 255 * (1 - k);
      src[i + 3] = 255;
    }
    return { rgba: new Uint8ClampedArray(src.buffer, src.byteOffset, src.byteLength), w, h };
  }
  const ow = Math.ceil(w / f);
  const oh = Math.ceil(h / f);
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = oy * f;
    const y1 = Math.min(h, y0 + f);
    for (let ox = 0; ox < ow; ox++) {
      const x0 = ox * f;
      const x1 = Math.min(w, x0 + f);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const k = src[i + 3] / 255;
          r += src[i] * k + 255 * (1 - k);
          g += src[i + 1] * k + 255 * (1 - k);
          b += src[i + 2] * k + 255 * (1 - k);
          n++;
        }
      }
      const q = (oy * ow + ox) * 4;
      out[q] = r / n;
      out[q + 1] = g / n;
      out[q + 2] = b / n;
      out[q + 3] = 255;
    }
  }
  return { rgba: out, w: ow, h: oh };
}

/** PDF page size in points: from the scan's resolution, otherwise fit to 1200 pt. */
function pageSize(w: number, h: number, dx: number, dy: number) {
  if (dx && dy) return [(w / dx) * 72, (h / dy) * 72] as const;
  const s = Math.min(1, 1200 / Math.max(w, h));
  return [w * s, h * s] as const;
}

type Sharp = typeof import("sharp").default;

export async function tiffToPdf(data: Uint8Array): Promise<Buffer> {
  let sharp: Sharp | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch (err) {
    console.warn("[pdftek] sharp unavailable, using the built-in TIFF decoder", err);
  }
  if (sharp) {
    try {
      return await tiffToPdfSharp(sharp, data);
    } catch (err) {
      console.warn("[pdftek] sharp couldn't read this TIFF, trying the built-in decoder", err);
    }
  }
  return tiffToPdfUtif(data);
}

async function tiffToPdfSharp(sharp: Sharp, data: Uint8Array): Promise<Buffer> {
  const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const opts = { limitInputPixels: false as const };
  const pages = (await sharp(input, opts).metadata()).pages ?? 1;
  const doc = await PDFDocument.create();

  for (let i = 0; i < pages; i++) {
    const page = sharp(input, { ...opts, page: i });
    const m = await page.metadata();
    const w = m.width ?? 0;
    const h = m.height ?? 0;
    if (!w || !h) continue;
    const f = factorFor(w, h);
    const sized = f > 1 ? page.resize({ width: Math.ceil(w / f), height: Math.ceil(h / f), fit: "fill" }) : page;
    // Black-and-white pages at their own size stay lossless; reduced ones (smoothed into grays) and
    // everything else are high-quality JPEG, which is far smaller and quicker to embed.
    const bilevel = m.bitsPerSample === 1 && (m.channels ?? 1) === 1;
    const embedded =
      bilevel && f === 1
        ? await doc.embedPng(await sized.toColourspace("b-w").png({ compressionLevel: 6 }).toBuffer())
        : await doc.embedJpg(
            await sized.flatten({ background: "#ffffff" }).toColourspace(bilevel || m.space === "b-w" ? "b-w" : "srgb").jpeg({ quality: 88 }).toBuffer(),
          );
    const d = m.density && m.density >= 30 && m.density <= 2400 ? m.density : 0; // sharp reports dpi
    const [pw, ph] = pageSize(w, h, d, d);
    doc.addPage([pw, ph]).drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
  }
  if (!doc.getPageCount()) throw new Error("No images found in this TIFF file.");
  return Buffer.from(await doc.save());
}

async function tiffToPdfUtif(data: Uint8Array): Promise<Buffer> {
  const mod = await import("utif2");
  const UTIF = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const ifds = (UTIF.decode(buf) as unknown as IFD[]).filter((ifd) => ((first(ifd.t254) ?? 0) & 1) === 0 && ifd.t256 && ifd.t257);
  if (!ifds.length) throw new Error("No images found in this TIFF file.");
  const doc = await PDFDocument.create();

  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd as never);
    const w = ifd.width;
    const h = ifd.height;
    if (!w || !h || !ifd.data) continue;
    const bps = first(ifd.t258) ?? 1;
    const spp = first(ifd.t277) ?? 1;
    const photometric = first(ifd.t262) ?? 0;
    const f = factorFor(w, h);
    const bilevel = bps === 1 && spp === 1 && (photometric === 0 || photometric === 1);

    let page: { rgba: Uint8ClampedArray; w: number; h: number };
    if (bilevel) {
      page = bilevelToRgba(ifd.data, w, h, photometric === 0, f);
    } else {
      const rgba = UTIF.toRGBA8(ifd as never);
      ifd.data = null; // the decoded source isn't needed once it's RGBA
      page = reduceRgba(rgba, w, h, f);
    }
    ifd.data = null;

    const canvas = createCanvas(page.w, page.h);
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(page.w, page.h);
    img.data.set(page.rgba);
    ctx.putImageData(img, 0, 0);
    // Pure black-and-white pages stay lossless; everything else is high-quality JPEG.
    const embedded = bilevel && f === 1 ? await doc.embedPng(canvas.toBuffer("image/png")) : await doc.embedJpg(canvas.toBuffer("image/jpeg", 88));
    canvas.width = 1; // release the pixel memory now rather than at the next GC
    canvas.height = 1;

    const dx = dpi(ifd, "t282");
    const dy = dpi(ifd, "t283") || dx;
    const [pw, ph] = pageSize(w, h, dx, dy);
    doc.addPage([pw, ph]).drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
  }
  if (!doc.getPageCount()) throw new Error("This TIFF file couldn't be read.");
  return Buffer.from(await doc.save());
}
