"use client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { canvasToBlob, pageToCanvas } from "./pdf";

export type Progress = (done: number, total: number) => void;
const base = (name: string) => name.replace(/\.pdf$/i, "");

type Line = { y: number; items: { x: number; w: number; str: string; size: number; bold: boolean }[] };

/** Groups text items into visual lines (top-to-bottom) with x positions for column detection. */
async function pageLines(page: PDFPageProxy): Promise<{ lines: Line[]; width: number }> {
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const styles = content.styles as Record<string, { fontFamily: string }>;
  const lines: Line[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const size = Math.hypot(it.transform[2], it.transform[3]);
    const bold = /bold|black|heavy/i.test(`${it.fontName} ${styles[it.fontName]?.fontFamily ?? ""}`);
    let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, size * 0.4));
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, w: it.width, str: it.str, size, bold });
  }
  lines.sort((a, b) => a.y - b.y);
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return { lines, width: vp.width };
}

function lineText(l: Line) {
  let out = "";
  let end = -1;
  for (const it of l.items) {
    if (end >= 0 && it.x - end > it.size * 0.25 && !out.endsWith(" ")) out += " ";
    out += it.str;
    end = it.x + it.w;
  }
  return out.trim();
}

/** Splits a line into cells wherever the horizontal gap is large. */
function lineCells(l: Line): { x: number; text: string }[] {
  const cells: { x: number; text: string; end: number }[] = [];
  for (const it of l.items) {
    const last = cells[cells.length - 1];
    if (last && it.x - last.end < Math.max(8, it.size * 1.2)) {
      last.text += (it.x - last.end > it.size * 0.2 ? " " : "") + it.str;
      last.end = it.x + it.w;
    } else cells.push({ x: it.x, text: it.str, end: it.x + it.w });
  }
  return cells.map((c) => ({ x: c.x, text: c.text.trim() }));
}

export async function toDocx(pdf: PDFDocumentProxy, name: string, onProgress?: Progress): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { lines } = await pageLines(page);
    const sizes = lines.flatMap((l) => l.items.map((i) => i.size)).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] ?? 11;
    // Merge wrapped lines into paragraphs using vertical gaps.
    let para: string[] = [];
    let paraSize = body;
    let paraBold = false;
    let lastY = -1;
    const flush = () => {
      if (!para.length) return;
      const text = para.join(" ").replace(/\s+/g, " ").trim();
      const heading = paraSize > body * 1.25 ? (paraSize > body * 1.6 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2) : undefined;
      children.push(new Paragraph({ heading, spacing: { after: 120 }, children: [new TextRun({ text, bold: paraBold && !heading, size: heading ? undefined : Math.round(Math.min(Math.max(body, 9), 14) * 2) })] }));
      para = [];
    };
    for (const l of lines) {
      const size = Math.max(...l.items.map((i) => i.size));
      const gap = lastY < 0 ? 0 : l.y - lastY;
      const bold = l.items.every((i) => i.bold);
      if (lastY >= 0 && (gap > size * 1.9 || Math.abs(size - paraSize) > 1.5 || bold !== paraBold)) flush();
      if (!para.length) {
        paraSize = size;
        paraBold = bold;
      }
      para.push(lineText(l));
      lastY = l.y;
    }
    flush();
    if (p < pdf.numPages) children.push(new Paragraph({ children: [new PageBreak()] }));
    onProgress?.(p, pdf.numPages);
  }
  const doc = new Document({ creator: "pdftek", title: base(name), sections: [{ children }] });
  return Packer.toBlob(doc);
}

export async function toXlsx(pdf: PDFDocumentProxy, onProgress?: Progress): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { lines } = await pageLines(page);
    const rows = lines.map(lineCells);
    // Build column anchors from x positions across the page.
    const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
    const anchors: number[] = [];
    for (const x of xs) if (!anchors.length || x - anchors[anchors.length - 1] > 18) anchors.push(x);
    const grid = rows.map((cells) => {
      const row: string[] = new Array(anchors.length).fill("");
      for (const c of cells) {
        let idx = 0;
        for (let i = 0; i < anchors.length; i++) if (Math.abs(anchors[i] - c.x) < Math.abs(anchors[idx] - c.x)) idx = i;
        row[idx] = row[idx] ? `${row[idx]} ${c.text}` : c.text;
      }
      return row.map((v) => {
        const n = v.replace(/[,$€£\s]/g, "");
        return /^-?\(?\d+(\.\d+)?\)?%?$/.test(n) && n.length < 16 ? Number(n.replace(/[()%]/g, "")) * (n.startsWith("(") ? -1 : 1) : v;
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(grid.length ? grid : [["(no text on this page — run OCR first)"]]);
    XLSX.utils.book_append_sheet(wb, ws, `Page ${p}`);
    onProgress?.(p, pdf.numPages);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function toPptx(pdf: PDFDocumentProxy, name: string, onProgress?: Progress): Promise<Blob> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
  const W = 10;
  const H = (first.height / first.width) * W;
  pptx.defineLayout({ name: "PDF", width: W, height: H });
  pptx.layout = "PDF";
  pptx.title = base(name);
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const canvas = await pageToCanvas(page, 2);
    const slide = pptx.addSlide();
    slide.addImage({ data: canvas.toDataURL("image/jpeg", 0.9), x: 0, y: 0, w: W, h: H });
    const { lines } = await pageLines(page);
    const notes = lines.map(lineText).join("\n");
    if (notes) slide.addNotes(notes);
    onProgress?.(p, pdf.numPages);
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}

export async function toImages(
  pdf: PDFDocumentProxy,
  name: string,
  format: "jpg" | "png" | "webp" | "tiff",
  pages: number[],
  onProgress?: Progress,
): Promise<{ blob: Blob; filename: string }> {
  const files: { name: string; blob: Blob }[] = [];
  for (const [i, p] of pages.entries()) {
    const page = await pdf.getPage(p);
    const transparent = format === "png";
    const canvas = await pageToCanvas(page, 2, transparent ? "rgba(0,0,0,0)" : "#ffffff");
    let blob: Blob;
    if (format === "tiff") {
      const mod = await import("utif2");
      const encodeImage = mod.encodeImage ?? (mod as unknown as { default: typeof mod }).default.encodeImage;
      const rgba = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      blob = new Blob([encodeImage(new Uint8Array(rgba.buffer), canvas.width, canvas.height)], { type: "image/tiff" });
    } else {
      blob = await canvasToBlob(canvas, format === "jpg" ? "image/jpeg" : `image/${format}`, format === "png" ? undefined : format === "webp" ? 0.82 : 0.92);
    }
    files.push({ name: `${base(name)}-p${String(p).padStart(3, "0")}.${format}`, blob });
    onProgress?.(i + 1, pages.length);
  }
  if (files.length === 1) return { blob: files[0].blob, filename: files[0].name };
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  return { blob: await zip.generateAsync({ type: "blob" }), filename: `${base(name)}-${format}.zip` };
}

export async function toText(pdf: PDFDocumentProxy, onProgress?: Progress): Promise<Blob> {
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const { lines } = await pageLines(await pdf.getPage(p));
    parts.push(`--- Page ${p} ---\n${lines.map(lineText).join("\n")}`);
    onProgress?.(p, pdf.numPages);
  }
  return new Blob([parts.join("\n\n")], { type: "text/plain;charset=utf-8" });
}
