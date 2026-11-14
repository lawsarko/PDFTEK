"use client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { isSerif, parseFontName } from "../font-names";

type PdfJs = typeof import("pdfjs-dist");
let libPromise: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  libPromise ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return lib;
  });
  return libPromise;
}

const cache = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(src: string | Uint8Array): Promise<PDFDocumentProxy> {
  if (typeof src !== "string") {
    return pdfjs().then((lib) => lib.getDocument({ data: src.slice(), isEvalSupported: false }).promise);
  }
  let p = cache.get(src);
  if (!p) {
    p = pdfjs().then((lib) => lib.getDocument({ url: src, isEvalSupported: false, withCredentials: true }).promise);
    p.catch(() => cache.delete(src));
    cache.set(src, p);
    if (cache.size > 12) {
      const first = cache.keys().next().value!;
      cache.get(first)?.then((d) => d.destroy()).catch(() => {});
      cache.delete(first);
    }
  }
  return p;
}

export function forgetPdf(src: string) {
  const p = cache.get(src);
  cache.delete(src);
  p?.then((d) => d.destroy()).catch(() => {});
}

/** Renders a page into a canvas at the given CSS scale, handling device pixel ratio. */
export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, dpr = window.devicePixelRatio || 1) {
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(dpr, 2);
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext("2d")!;
  const task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
  await task.promise;
  return viewport;
}

/** Renders a page to an offscreen canvas at an absolute pixel scale (for export). */
export async function pageToCanvas(page: PDFPageProxy, scale: number, background = "#ffffff") {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), type, quality));
}

export type TextRun = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  /** Real font family from the embedded font name, e.g. "EB Garamond". */
  family: string;
  serif: boolean;
  bold: boolean;
  italic: boolean;
  /** Glyph extent above/below the baseline, as fractions of the font size. */
  ascent: number;
  descent: number;
};

type Item = { str: string; x: number; y: number; w: number; size: number; family: string; bold: boolean; italic: boolean; ascent: number; descent: number };

/**
 * Returns editable text segments in PDF user space (origin bottom-left). Fragments that pdf.js
 * reports separately are joined into whole segments: the same line, the same font/style/size,
 * and no column-sized gap. Editing a whole segment avoids overlaps when text changes length.
 */
export async function textRuns(page: PDFPageProxy): Promise<TextRun[]> {
  await page.getOperatorList(); // loads fonts so their real names are available
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily: string; ascent?: number; descent?: number }>;
  const items: Item[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const t = item.transform as number[];
    const size = Math.hypot(t[2], t[3]) || item.height || 10;
    let raw = "";
    try {
      raw = (page.commonObjs.get(item.fontName) as { name?: string } | null)?.name ?? "";
    } catch {}
    const face = parseFontName(raw || styles[item.fontName]?.fontFamily || "");
    const st = styles[item.fontName];
    const visible = item.str.trimEnd().length;
    items.push({
      str: item.str,
      x: t[4],
      y: t[5],
      w: visible ? (item.width * visible) / item.str.length : 0,
      size,
      family: face.family,
      bold: face.bold,
      italic: face.italic,
      ascent: st?.ascent && Number.isFinite(st.ascent) ? st.ascent : 0.9,
      descent: st?.descent && Number.isFinite(st.descent) ? st.descent : -0.25,
    });
  }

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const out: TextRun[] = [];
  let cur: (TextRun & { end: number }) | null = null;
  const flush = () => {
    if (cur && cur.str.trim()) {
      cur.str = cur.str.replace(/\s+/g, " ").replace(/[\uFB00-\uFB06]/g, (l) => l.normalize("NFKC")).trim();
      cur.w = cur.end - cur.x;
      const { end: _end, ...run } = cur;
      out.push(run);
    }
    cur = null;
  };
  for (const it of items) {
    const blank = !it.str.trim();
    if (cur) {
      const c: TextRun & { end: number } = cur;
      const sameLine = Math.abs(it.y - c.y) < Math.max(1.5, c.size * 0.3);
      const gap = it.x - c.end;
      const sameStyle = it.family === c.family && it.bold === c.bold && it.italic === c.italic && Math.abs(it.size - c.size) < 0.6;
      if (sameLine && (blank || (sameStyle && gap < c.size * 1.2 && gap > -c.size))) {
        if (!blank) {
          if (gap > c.size * 0.15 && !c.str.endsWith(" ") && !it.str.startsWith(" ")) c.str += " ";
          c.str += it.str;
          c.end = Math.max(c.end, it.x + it.w);
          c.ascent = Math.max(c.ascent, it.ascent);
          c.descent = Math.min(c.descent, it.descent);
        } else if (!c.str.endsWith(" ")) c.str += " ";
        continue;
      }
      flush();
    }
    if (blank) continue;
    cur = { str: it.str, x: it.x, y: it.y, w: it.w, h: it.size, size: it.size, family: it.family, serif: isSerif(it.family), bold: it.bold, italic: it.italic, ascent: it.ascent, descent: it.descent, end: it.x + it.w };
  }
  flush();
  return out;
}
