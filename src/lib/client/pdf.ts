"use client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

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

export type TextRun = { str: string; x: number; y: number; w: number; h: number; size: number; font: string; serif: boolean; bold: boolean; italic: boolean };

/** Returns text runs in PDF user-space coordinates (origin bottom-left). */
export async function textRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily: string }>;
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const t = item.transform as number[];
    const size = Math.hypot(t[2], t[3]) || item.height || 10;
    const fam = `${item.fontName} ${styles[item.fontName]?.fontFamily ?? ""}`.toLowerCase();
    runs.push({
      str: item.str,
      x: t[4],
      y: t[5],
      w: item.width,
      h: item.height || size,
      size,
      font: item.fontName,
      serif: /serif|times|georgia|garamond|roman|cambria|book/.test(fam) && !/sans/.test(fam),
      bold: /bold|black|heavy|semibold/.test(fam),
      italic: /italic|oblique/.test(fam),
    });
  }
  return runs;
}
