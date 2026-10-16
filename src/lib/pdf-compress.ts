import "server-only";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict, PDFArray, PDFRef, PDFStream, type PDFObject } from "pdf-lib";

/**
 * Real PDF compression. Most of a big PDF's weight is images, so this:
 *  1. downsamples oversized images and re-encodes them as JPEG at a level-dependent quality
 *     (only when that actually makes the image smaller),
 *  2. drops objects nothing references any more and bulky XMP metadata/thumbnails,
 *  3. writes with compressed object streams,
 *  4. also runs Ghostscript when it's installed (the Docker image has it) and keeps whichever
 *     result is smallest. The original is kept if nothing helps.
 */
export type CompressLevel = "light" | "recommended" | "strong";

const SETTINGS: Record<CompressLevel, { maxPx: number; quality: number; gs: string; gsDpi: number }> = {
  light: { maxPx: 3000, quality: 0.85, gs: "/printer", gsDpi: 220 },
  recommended: { maxPx: 2000, quality: 0.72, gs: "/ebook", gsDpi: 150 },
  strong: { maxPx: 1300, quality: 0.55, gs: "/screen", gsDpi: 96 },
};

export type CompressResult = { pdf: Buffer; before: number; after: number; method: string; images: number };

export async function compressPdf(data: Buffer, level: CompressLevel = "recommended"): Promise<CompressResult> {
  const before = data.length;
  const candidates: { pdf: Buffer; method: string; images: number }[] = [];
  try {
    const r = await compressWithPdfLib(data, level);
    candidates.push({ pdf: r.pdf, method: "images", images: r.images });
  } catch (err) {
    console.error("[pdftek] compression (images) failed", err);
  }
  const gs = await ghostscript(data, level).catch(() => null);
  if (gs) candidates.push({ pdf: gs, method: "ghostscript", images: 0 });
  // Keep the smallest result that is still a valid PDF.
  let best: { pdf: Buffer; method: string; images: number } = { pdf: data, method: "none", images: 0 };
  for (const c of candidates.sort((a, b) => a.pdf.length - b.pdf.length)) {
    if (c.pdf.length >= best.pdf.length) break;
    try {
      const check = await PDFDocument.load(c.pdf, { updateMetadata: false });
      if (check.getPageCount() > 0) best = c;
      break;
    } catch {}
  }
  return { ...best, before, after: best.pdf.length };
}

// ---------- images ----------

type Canvas = typeof import("@napi-rs/canvas");
let canvasMod: Promise<Canvas> | null = null;
const canvasLib = () => (canvasMod ??= import("@napi-rs/canvas"));

async function compressWithPdfLib(data: Buffer, level: CompressLevel) {
  const { maxPx, quality } = SETTINGS[level];
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const ctx = doc.context;
  let images = 0;

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    try {
      const next = await recodeImage(obj, maxPx, quality);
      if (next && next.length < obj.contents.length * 0.9) {
        const w = next.width;
        const h = next.height;
        const nd = dict.clone(ctx);
        for (const k of ["Filter", "DecodeParms", "Length", "Decode"]) nd.delete(PDFName.of(k));
        nd.set(PDFName.of("Width"), PDFNumber.of(w));
        nd.set(PDFName.of("Height"), PDFNumber.of(h));
        nd.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
        nd.set(PDFName.of("ColorSpace"), PDFName.of(next.gray ? "DeviceGray" : "DeviceRGB"));
        nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
        // A soft mask must match the new size, so resample it too.
        const smaskRef = dict.get(PDFName.of("SMask"));
        if (smaskRef instanceof PDFRef && (w !== next.srcW || h !== next.srcH)) {
          const smask = ctx.lookup(smaskRef);
          if (smask instanceof PDFRawStream) {
            const resized = await resizeMask(smask, w, h);
            if (resized) ctx.assign(smaskRef, resized);
            else continue; // can't keep the mask consistent: leave this image alone
          }
        }
        ctx.assign(ref, PDFRawStream.of(nd, next.bytes));
        images++;
      }
    } catch {
      // Unusual image encodings are left untouched.
    }
  }

  dropUnreferenced(doc);
  doc.catalog.delete(PDFName.of("Metadata"));
  for (const page of doc.getPages()) page.node.delete(PDFName.of("Thumb"));
  doc.setProducer("pdftek");
  const pdf = Buffer.from(await doc.save({ useObjectStreams: true }));
  return { pdf, images };
}

type Recoded = { bytes: Uint8Array; width: number; height: number; srcW: number; srcH: number; gray: boolean; length: number };

async function recodeImage(stream: PDFRawStream, maxPx: number, quality: number): Promise<Recoded | null> {
  const d = stream.dict;
  const num = (k: string) => (d.lookup(PDFName.of(k)) as PDFNumber | undefined)?.asNumber();
  const width = num("Width") ?? 0;
  const height = num("Height") ?? 0;
  if (width * height < 120 * 120) return null; // icons and rules aren't worth it
  if (d.lookup(PDFName.of("ImageMask"))?.toString() === "true") return null;
  if (d.has(PDFName.of("Decode")) || d.has(PDFName.of("Mask"))) return null; // colour-key masks need exact colours

  const filters = filterNames(d.lookup(PDFName.of("Filter")));
  const cs = colorComponents(d.lookup(PDFName.of("ColorSpace")), stream);
  const { createCanvas, loadImage, ImageData } = await canvasLib();

  let source: { draw: (c: import("@napi-rs/canvas").SKRSContext2D, w: number, h: number) => void } | null = null;

  if (filters.length === 1 && filters[0] === "DCTDecode") {
    if (cs !== 1 && cs !== 3) return null; // CMYK JPEGs need colour conversion: skip
    const img = await loadImage(Buffer.from(stream.contents));
    source = { draw: (c, w, h) => c.drawImage(img, 0, 0, w, h) };
  } else if (filters.length <= 1 && (filters[0] === "FlateDecode" || filters.length === 0)) {
    if ((num("BitsPerComponent") ?? 8) !== 8 || (cs !== 1 && cs !== 3)) return null;
    let raw: Buffer = filters.length ? zlib.inflateSync(stream.contents) : Buffer.from(stream.contents);
    const parms = d.lookup(PDFName.of("DecodeParms"));
    const predictor = parms instanceof PDFDict ? (parms.lookup(PDFName.of("Predictor")) as PDFNumber | undefined)?.asNumber() ?? 1 : 1;
    if (predictor >= 10) raw = unPng(raw, width, height, cs);
    else if (predictor !== 1) return null;
    if (raw.length < width * height * cs) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += cs) {
      const o = i * 4;
      rgba[o] = raw[j];
      rgba[o + 1] = raw[cs === 3 ? j + 1 : j];
      rgba[o + 2] = raw[cs === 3 ? j + 2 : j];
      rgba[o + 3] = 255;
    }
    const full = createCanvas(width, height);
    full.getContext("2d").putImageData(new ImageData(rgba, width, height) as unknown as Parameters<ReturnType<typeof full.getContext>["putImageData"]>[0], 0, 0);
    source = { draw: (c, w, h) => c.drawImage(full, 0, 0, w, h) };
  }
  if (!source) return null;

  const scale = Math.min(1, maxPx / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(w, h);
  const c = canvas.getContext("2d");
  c.imageSmoothingQuality = "high";
  c.fillStyle = "#fff";
  c.fillRect(0, 0, w, h);
  source.draw(c, w, h);
  const bytes = await canvas.encode("jpeg", Math.round(quality * 100));
  return { bytes: new Uint8Array(bytes), width: w, height: h, srcW: width, srcH: height, gray: false, length: bytes.length };
}

async function resizeMask(mask: PDFRawStream, w: number, h: number): Promise<PDFRawStream | null> {
  const d = mask.dict;
  const mw = (d.lookup(PDFName.of("Width")) as PDFNumber).asNumber();
  const mh = (d.lookup(PDFName.of("Height")) as PDFNumber).asNumber();
  const filters = filterNames(d.lookup(PDFName.of("Filter")));
  if ((d.lookup(PDFName.of("BitsPerComponent")) as PDFNumber | undefined)?.asNumber() !== 8) return null;
  if (filters.length > 1 || (filters.length === 1 && filters[0] !== "FlateDecode")) return null;
  let raw: Buffer = filters.length ? zlib.inflateSync(mask.contents) : Buffer.from(mask.contents);
  const parms = d.lookup(PDFName.of("DecodeParms"));
  if (parms instanceof PDFDict && ((parms.lookup(PDFName.of("Predictor")) as PDFNumber | undefined)?.asNumber() ?? 1) >= 10) raw = unPng(raw, mw, mh, 1);
  const out = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mh - 1, Math.floor((y * mh) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = raw[sy * mw + Math.min(mw - 1, Math.floor((x * mw) / w))];
  }
  const nd = d.clone(mask.dict.context);
  nd.delete(PDFName.of("DecodeParms"));
  nd.set(PDFName.of("Width"), PDFNumber.of(w));
  nd.set(PDFName.of("Height"), PDFNumber.of(h));
  nd.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
  return PDFRawStream.of(nd, zlib.deflateSync(out, { level: 9 }));
}

function filterNames(f: PDFObject | undefined): string[] {
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : "?"));
  return ["?"];
}

/** Number of colour components for simple colour spaces; 0 for anything we don't handle. */
function colorComponents(cs: PDFObject | undefined, stream: PDFStream): number {
  if (cs instanceof PDFName) return { DeviceGray: 1, DeviceRGB: 3, CalGray: 1, CalRGB: 3 }[cs.decodeText()] ?? 0;
  if (cs instanceof PDFArray) {
    const kind = cs.get(0);
    if (kind instanceof PDFName && kind.decodeText() === "ICCBased") {
      const profile = stream.dict.context.lookup(cs.get(1));
      const n = profile instanceof PDFStream ? (profile.dict.lookup(PDFName.of("N")) as PDFNumber | undefined)?.asNumber() : undefined;
      return n === 1 || n === 3 ? n : 0;
    }
    if (kind instanceof PDFName && (kind.decodeText() === "CalRGB" || kind.decodeText() === "CalGray")) return kind.decodeText() === "CalRGB" ? 3 : 1;
  }
  return 0;
}

/** Reverses PNG row filters (FlateDecode with Predictor >= 10). */
function unPng(data: Buffer, width: number, height: number, bpp: number): Buffer {
  const row = width * bpp;
  const out = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    const type = data[y * (row + 1)];
    const src = y * (row + 1) + 1;
    const dst = y * row;
    for (let x = 0; x < row; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - row + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - row + x - bpp] : 0;
      const v = data[src + x];
      let r: number;
      if (type === 1) r = v + a;
      else if (type === 2) r = v + b;
      else if (type === 3) r = v + ((a + b) >> 1);
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else r = v;
      out[dst + x] = r & 255;
    }
  }
  return out;
}

/** Deletes indirect objects that nothing reachable from the trailer refers to (old revisions, orphans). */
function dropUnreferenced(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<string>();
  const visit = (o: PDFObject | undefined) => {
    if (!o) return;
    if (o instanceof PDFRef) {
      const k = o.toString();
      if (seen.has(k)) return;
      seen.add(k);
      visit(ctx.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) visit(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) visit(v);
    } else if (o instanceof PDFStream) {
      visit(o.dict);
    }
  };
  visit(ctx.trailerInfo.Root);
  visit(ctx.trailerInfo.Info);
  visit(ctx.trailerInfo.Encrypt);
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) ctx.delete(ref);
}

// ---------- Ghostscript (optional) ----------

const execFileAsync = promisify(execFile);
let gsPath: Promise<string | null> | null = null;
function findGs() {
  gsPath ??= (async () => {
    for (const p of [process.env.GS_PATH, "/usr/bin/gs", "/usr/local/bin/gs", "/opt/homebrew/bin/gs"]) {
      if (!p) continue;
      try {
        await fs.access(p);
        return p;
      } catch {}
    }
    return null;
  })();
  return gsPath;
}

async function ghostscript(data: Buffer, level: CompressLevel): Promise<Buffer | null> {
  const bin = await findGs();
  if (!bin) return null;
  const { gs, gsDpi } = SETTINGS[level];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdftek-gs-"));
  try {
    const input = path.join(dir, "in.pdf");
    const output = path.join(dir, "out.pdf");
    await fs.writeFile(input, data);
    await execFileAsync(
      bin,
      [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.6",
        `-dPDFSETTINGS=${gs}`,
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        "-dSAFER",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        "-dSubsetFonts=true",
        `-dColorImageResolution=${gsDpi}`,
        `-dGrayImageResolution=${gsDpi}`,
        `-sOutputFile=${output}`,
        input,
      ],
      { timeout: 180_000 },
    );
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
