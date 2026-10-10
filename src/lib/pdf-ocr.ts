import "server-only";
import path from "node:path";
import { StandardFonts, PDFDocument, type PDFFont } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Run } from "./pdf-layout";

/**
 * OCR for pages without a usable text layer: scans, and PDFs whose text was exported
 * as vector outlines. Renders the page, recognizes words with Tesseract, measures each
 * word's size, color and weight from the pixels, and produces a "clean" background image
 * with the text erased so converters can lay editable text over the page's graphics.
 */

export type OcrPage = { runs: Run[]; background: Buffer; backgroundType: "jpg" };

const OCR_SCALE = 4; // ~288 dpi: small print (receipts, footers) needs the resolution
const BG_SCALE = 2; // background image resolution (~144 dpi) keeps files small
const MIN_CONFIDENCE = 45;

type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function worker(): Promise<Worker> {
  workerPromise ??= import("tesseract.js").then(({ createWorker }) =>
    createWorker("eng", 1, {
      langPath: path.join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0_best_int"),
      cacheMethod: "none",
      gzip: true,
    }),
  );
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

/** Serializes OCR jobs through the single shared worker. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
}

let helvetica: Promise<{ regular: PDFFont; bold: PDFFont }> | null = null;
function metrics() {
  helvetica ??= PDFDocument.create().then(async (d) => ({ regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold) }));
  return helvetica;
}

type Canvas = { width: number; height: number; toBuffer(mime: string, quality?: number): Buffer };
type Ctx = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
};
type Factory = { create(w: number, h: number): { canvas: Canvas; context: Ctx } };

type Word = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrLine = { text: string; bbox: Word["bbox"]; baseline?: { y0: number; y1: number; x0: number; x1: number }; words: Word[] };

export async function ocrPage(doc: PDFDocumentProxy, pageNumber: number): Promise<OcrPage> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: OCR_SCALE });
  const factory = (doc as unknown as { canvasFactory: Factory }).canvasFactory;
  const { canvas, context } = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
  const png = canvas.toBuffer("image/png");

  const data = await enqueue(async () => (await (await worker()).recognize(png, {}, { blocks: true })).data);
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push(l as unknown as OcrLine);

  const img = context.getImageData(0, 0, canvas.width, canvas.height);
  const { regular, bold } = await metrics();
  const runs: Run[] = [];
  const erase: { box: Word["bbox"]; bg: string }[] = [];

  // Group words into clusters: an OCR "line" often spans several columns of a layout, and
  // each column can have its own size and baseline.
  type Cluster = { words: Word[]; samples: ReturnType<typeof sample>[]; lineH: number };
  const clusters: Cluster[] = [];
  for (const line of lines) {
    const lineH = (line.bbox.y1 - line.bbox.y0) / OCR_SCALE;
    const words = line.words.filter((w) => {
      const t = w.text.trim();
      if (!t || w.confidence < MIN_CONFIDENCE) return false;
      const alnum = /[\p{L}\p{N}$€£%&@#]/u.test(t);
      if (!alnum && (t.length < 2 || w.confidence < 75)) return false; // specks read as punctuation
      if (w.confidence < 60 && (w.bbox.y1 - w.bbox.y0) / OCR_SCALE < lineH * 0.5) return false;
      return true;
    });
    let cur: Cluster | null = null;
    for (const w of words.sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      const h = (w.bbox.y1 - w.bbox.y0) / OCR_SCALE;
      const prev = cur?.words[cur.words.length - 1];
      if (!cur || !prev || (w.bbox.x0 - prev.bbox.x1) / OCR_SCALE > Math.max(lineH, h) * 1.6) {
        cur = { words: [], samples: [], lineH };
        clusters.push(cur);
      }
      cur.words.push(w);
      cur.samples.push(sample(img, w.bbox));
    }
  }

  // Typical stroke thickness per text size; bold text has clearly thicker strokes than its peers.
  const strokes = clusters.flatMap((c) => c.samples.map((x) => x.stroke)).filter((x) => x > 0).sort((a, b) => a - b);
  const pageStroke = strokes[Math.floor(strokes.length * 0.4)] || 0.1;

  for (const c of clusters) {
    const words = c.words;
    // A lone one-character "word" is almost always a speck or a piece of a rule line.
    if (words.length === 1 && words[0].text.trim().length === 1 && words[0].confidence < 92) continue;
    const text = words.map((w) => w.text).join(" ");
    const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
    const stroke = c.samples.map((x) => x.stroke).sort((a, b) => a - b)[Math.floor(c.samples.length / 2)];
    // Digits and capitals have naturally heavier strokes than lowercase text; demand more for them.
    const digitShare = (text.match(/\p{N}/gu)?.length ?? 0) / Math.max(1, letters);
    const lowerShare = (text.match(/\p{Ll}/gu)?.length ?? 0) / Math.max(1, letters);
    const threshold = digitShare > 0.3 ? 1.5 : lowerShare < 0.3 ? 1.28 : 1.22;
    const isBold = letters >= 3 && stroke > pageStroke * threshold;
    const font = isBold ? bold : regular;

    // Size the cluster so Arial/Helvetica reproduces the measured width of its words.
    const inkWidth = words.reduce((s, w) => s + (w.bbox.x1 - w.bbox.x0), 0) / OCR_SCALE;
    const glyphWidth = words.reduce((s, w) => s + font.widthOfTextAtSize(safe(font, w.text), 1), 0);
    const height = Math.max(...words.map((w) => (w.bbox.y1 - w.bbox.y0) / OCR_SCALE));
    const byWidth = glyphWidth > 0 ? inkWidth / glyphWidth : height;
    // Primary estimate from glyph heights (cap/ascender height ≈ 0.72em, descenders add ≈ 0.21em);
    // widths vary more between fonts (digits especially), so they only bound the result.
    const byHeight = words
      .map((w) => {
        const h = (w.bbox.y1 - w.bbox.y0) / OCR_SCALE;
        const tall = /[\p{Lu}\p{N}bdfhklt!?#$%&@()\[\]{}\/|]/u.test(w.text);
        const desc = /[gjpqyQ(),;]/.test(w.text);
        return h / ((tall ? 0.72 : 0.52) + (desc ? 0.21 : 0));
      })
      .sort((a, b) => a - b)[Math.floor(words.length / 2)];
    const size = round2(clamp(byHeight, byWidth * 0.85, byWidth * 1.15));

    // Baseline per cluster: bottoms of words without descenders sit on it.
    const bottoms = words.map((w) => w.bbox.y1 / OCR_SCALE - (/[gjpqyQ,;]/.test(w.text) ? size * 0.21 : 0)).sort((a, b) => a - b);
    const baseline = bottoms[Math.floor(bottoms.length / 2)];
    const ink = dominantHex(c.samples.map((x) => x.ink));

    words.forEach((w, i) => {
      runs.push({ str: w.text, x: w.bbox.x0 / OCR_SCALE, y: baseline, w: (w.bbox.x1 - w.bbox.x0) / OCR_SCALE, size, font: "Arial", bold: isBold, italic: false, color: ink, bg: c.samples[i].bg });
      erase.push({ box: w.bbox, bg: c.samples[i].bg });
    });
  }

  snapSizes(runs);

  // Erase recognized words from the page image, leaving graphics, boxes, bands and logos.
  for (const e of erase) {
    // Generous padding above and to the sides; tight below so underlines and rules survive.
    const pad = 3;
    context.fillStyle = `#${e.bg}`;
    context.fillRect(e.box.x0 - pad, e.box.y0 - pad, e.box.x1 - e.box.x0 + pad * 2, e.box.y1 - e.box.y0 + pad + 1);
  }
  const small = factory.create(Math.ceil((vp.width / OCR_SCALE) * BG_SCALE), Math.ceil((vp.height / OCR_SCALE) * BG_SCALE));
  small.context.drawImage(canvas, 0, 0, small.canvas.width, small.canvas.height);
  const background = small.canvas.toBuffer("image/jpeg", 85);
  page.cleanup();

  // Pages with no recognizable words (photos, diagrams) still keep their look via the background.
  return { runs: runs.sort((a, b) => a.y - b.y || a.x - b.x), background, backgroundType: "jpg" };
}

/** Background = dominant color of the ring around the box; ink = dominant color of pixels far from it. */
function sample(img: { data: Uint8ClampedArray; width: number; height: number }, b: Word["bbox"]) {
  const { data, width, height } = img;
  const px = (x: number, y: number) => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const ring: number[][] = [];
  for (let x = b.x0 - 2; x <= b.x1 + 2; x += 2) ring.push([...px(x, b.y0 - 3)], [...px(x, b.y1 + 3)]);
  for (let y = b.y0; y <= b.y1; y += 2) ring.push([...px(b.x0 - 3, y)], [...px(b.x1 + 3, y)]);
  const bg = dominant(ring);
  const ink: number[][] = [];
  let total = 0;
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      total++;
      const c = px(x, y);
      if (dist(c, bg) > 110) ink.push([...c]);
    }
  const inkColor = ink.length ? dominant(ink) : [0, 0, 0];
  // Stroke thickness: median length of horizontal ink runs, relative to the word's height.
  const lengths: number[] = [];
  for (let y = b.y0; y < b.y1; y++) {
    let run = 0;
    for (let x = b.x0; x <= b.x1; x++) {
      const isInk = x < b.x1 && dist(px(x, y), bg) > 110;
      if (isInk) run++;
      else if (run) {
        lengths.push(run);
        run = 0;
      }
    }
  }
  lengths.sort((a, c) => a - c);
  const stroke = lengths.length ? lengths[Math.floor(lengths.length / 2)] / Math.max(1, b.y1 - b.y0) : 0;
  return { bg: hex(bg), ink: hex(inkColor), density: total ? ink.length / total : 0, stroke };
}

/**
 * Measured sizes are noisy (±10%). Snap them to the page's few real text sizes: repeatedly take
 * the most common size (weighted by characters) and absorb everything within ±12% of it.
 */
function snapSizes(runs: Run[]) {
  const weight = new Map<number, number>();
  for (const r of runs) weight.set(r.size, (weight.get(r.size) ?? 0) + r.str.length);
  const remaining = new Set(weight.keys());
  const map = new Map<number, number>();
  while (remaining.size) {
    const anchor = [...remaining].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0))[0];
    const members = [...remaining].filter((sz) => Math.abs(sz - anchor) / anchor <= 0.12);
    const total = members.reduce((n, sz) => n + (weight.get(sz) ?? 0), 0);
    const mean = round2(members.reduce((n, sz) => n + sz * (weight.get(sz) ?? 0), 0) / total);
    for (const m of members) {
      map.set(m, mean);
      remaining.delete(m);
    }
  }
  for (const r of runs) r.size = map.get(r.size) ?? r.size;
}

function dominantHex(list: string[]): string {
  const counts = new Map<string, number>();
  for (const c of list) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "000000";
}

function dominant(colors: number[][]): number[] {
  const buckets = new Map<string, { n: number; sum: number[] }>();
  for (const c of colors) {
    const k = c.map((v) => v >> 5).join(",");
    const b = buckets.get(k) ?? { n: 0, sum: [0, 0, 0] };
    b.n++;
    b.sum[0] += c[0];
    b.sum[1] += c[1];
    b.sum[2] += c[2];
    buckets.set(k, b);
  }
  let best = { n: 0, sum: [255, 255, 255] };
  for (const b of buckets.values()) if (b.n > best.n) best = b;
  return best.n ? best.sum.map((v) => Math.round(v / best.n)) : [255, 255, 255];
}

const dist = (a: readonly number[], b: readonly number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const hex = (c: readonly number[]) => c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (n: number) => Math.round(n * 4) / 4;
function safe(f: PDFFont, text: string) {
  return [...text]
    .map((ch) => {
      try {
        f.encodeText(ch);
        return ch;
      } catch {
        return "o";
      }
    })
    .join("");
}
