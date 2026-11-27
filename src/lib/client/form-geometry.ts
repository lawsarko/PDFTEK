"use client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { pdfjs, pageToCanvas } from "./pdf";

/**
 * Prepares a form page for AI: a JPEG of the page plus "candidate" input areas found in the PDF's
 * own drawing (underlines, boxes, tick squares, runs of underscores). Candidates have exact
 * geometry, so fields the AI matches to them line up perfectly; the image covers scans and
 * anything the drawing doesn't reveal.
 */

export type Box = [number, number, number, number]; // image pixels: left, top, right, bottom
export type Candidate = { id: string; kind: "line" | "box" | "square" | "underscore"; box: Box };
export type PagePayload = {
  page: number;
  image: string;
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
  candidates: Candidate[];
};

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.8 && Math.abs(a[1] - b[1]) < 0.8;
/** Four corners joined by horizontal and vertical edges only. */
function isAxisRect(p: [number, number][]) {
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 0.8 && Math.abs(a[1] - b[1]) > 0.8) return false;
  }
  return true;
}

/** Renders and measures one page. `longEdge` is the image size in pixels. */
export async function pagePayload(doc: PDFDocumentProxy, pageNumber: number, longEdge = 1600, withCandidates = true): Promise<PagePayload> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, longEdge / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = await pageToCanvas(page, scale);
  // Dense scans can produce large images; step the quality down to stay under the upload cap.
  let image = canvas.toDataURL("image/jpeg", 0.72).split(",")[1];
  for (const q of [0.55, 0.4]) if (image.length > 1_900_000) image = canvas.toDataURL("image/jpeg", q).split(",")[1];
  const transform = viewport.transform as M;
  const candidates = withCandidates ? await findCandidates(page, transform, pageNumber, base.width, base.height) : [];
  canvas.width = 0; // free memory early on long forms
  return { page: pageNumber, image, width: Math.floor(viewport.width), height: Math.floor(viewport.height), transform, candidates };
}

async function findCandidates(page: PDFPageProxy, view: M, pageNumber: number, pageW: number, pageH: number): Promise<Candidate[]> {
  const { OPS } = await pdfjs();
  const ops = await page.getOperatorList();
  const lines: { x0: number; x1: number; y: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const stack: M[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as M);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args[0] as M | null;
      if (m) ctm = mul(ctm, m);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const [pathOps, coords] = args as [number[], number[]];
      let j = 0;
      let sub: [number, number][] = [];
      // A subpath of four axis-aligned edges is a box even when drawn with lines, not "re".
      const flush = () => {
        const pts = sub.length > 4 && near(sub[0], sub[sub.length - 1]) ? sub.slice(0, -1) : sub;
        if (pts.length === 4 && isAxisRect(pts)) {
          const xs = pts.map((q) => q[0]);
          const ys = pts.map((q) => q[1]);
          const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          if (r.h < 2 && r.w > 20) lines.push({ x0: r.x, x1: r.x + r.w, y: r.y + r.h / 2 });
          else if (r.w > 3 && r.h > 3) rects.push(r);
        } else {
          for (let k = 1; k < sub.length; k++) {
            const [ax, ay] = sub[k - 1];
            const [bx, by] = sub[k];
            if (Math.abs(by - ay) < 0.8 && Math.abs(bx - ax) > 20) lines.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y: (ay + by) / 2 });
          }
        }
        sub = [];
      };
      for (const op of pathOps) {
        if (op === OPS.rectangle) {
          flush();
          const [x, y, w, h] = [coords[j], coords[j + 1], coords[j + 2], coords[j + 3]];
          j += 4;
          const a = apply(ctm, x, y);
          const b = apply(ctm, x + w, y + h);
          const r = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
          // A very thin filled rectangle is how many PDFs draw an underline.
          if (r.h < 2 && r.w > 20) lines.push({ x0: r.x, x1: r.x + r.w, y: r.y + r.h / 2 });
          else if (r.w > 3 && r.h > 3) rects.push(r);
        } else if (op === OPS.moveTo) {
          flush();
          sub.push(apply(ctm, coords[j], coords[j + 1]));
          j += 2;
        } else if (op === OPS.lineTo) {
          sub.push(apply(ctm, coords[j], coords[j + 1]));
          j += 2;
        } else if (op === OPS.closePath) {
          if (sub.length) sub.push(sub[0]);
          flush();
        } else if (op === OPS.curveTo) {
          j += 6;
          sub = []; // curves aren't form boxes
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          j += 4;
          sub = [];
        }
      }
      flush();
    }
  }

  const out: Candidate[] = [];
  let n = 0;
  const px = (x0: number, y0: number, x1: number, y1: number): Box => {
    const a = apply(view, x0, y0);
    const b = apply(view, x1, y1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(Math.round) as Box;
  };
  const seen = new Set<string>();
  const add = (kind: Candidate["kind"], box: Box) => {
    const key = `${kind}:${box.map((v) => Math.round(v / 3)).join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `p${pageNumber}c${++n}`, kind, box });
  };

  // Underlines: the writing area sits just above the line, about one line of text tall.
  for (const l of lines) {
    const len = l.x1 - l.x0;
    if (len < 25 || len > pageW * 0.92) continue;
    add("line", px(l.x0, l.y, l.x1, l.y + 14));
  }
  for (const r of rects) {
    if (r.w >= 5 && r.w <= 20 && r.h >= 5 && r.h <= 20 && Math.abs(r.w - r.h) < 4) add("square", px(r.x, r.y, r.x + r.w, r.y + r.h));
    else if (r.w >= 25 && r.h >= 8 && r.h <= 220 && r.w < pageW * 0.97 && r.h < pageH * 0.5) add("box", px(r.x, r.y, r.x + r.w, r.y + r.h));
  }

  // Runs of underscores in the text ("Name: ________").
  const text = await page.getTextContent();
  for (const item of text.items) {
    if (!("str" in item) || !item.str.includes("___")) continue;
    const t = item.transform as number[];
    const size = Math.hypot(t[2], t[3]) || 10;
    const re = /_{3,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(item.str))) {
      const start = t[4] + (item.width * m.index) / item.str.length;
      const end = t[4] + (item.width * (m.index + m[0].length)) / item.str.length;
      add("underscore", px(start, t[5] - size * 0.15, end, t[5] + size * 1.1));
    }
  }

  // Reading order, top to bottom.
  return out.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]).slice(0, 600);
}
