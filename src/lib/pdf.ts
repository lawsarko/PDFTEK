import "server-only";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { id } from "./ids";
import { badRequest } from "./http";

const execFileAsync = promisify(execFile);

// ---------- text extraction ----------

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

export type PageText = { page: number; text: string };

/** Extracts text per page, reconstructing line breaks from glyph positions. */
export async function extractText(bytes: Uint8Array): Promise<{ pages: PageText[]; pageCount: number }> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
    verbosity: 0,
  }).promise;
  const pages: PageText[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let out = "";
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
        else if (out && !out.endsWith(" ") && item.str && !item.str.startsWith(" ")) out += " ";
        out += item.str;
        if (item.hasEOL) out += "\n";
        lastY = y;
      }
      pages.push({ page: i, text: out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() });
      page.cleanup();
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

export function looksScanned(pages: PageText[]): boolean {
  if (!pages.length) return false;
  const empty = pages.filter((p) => p.text.replace(/\s/g, "").length < 20).length;
  return empty / pages.length >= 0.5;
}

// ---------- normalizing uploads into PDF ----------

export const OFFICE_EXT = ["doc", "docx", "odt", "rtf", "ppt", "pptx", "odp", "xls", "xlsx", "ods", "html"];
export const IMAGE_EXT = ["jpg", "jpeg", "png"];
export const TEXT_EXT = ["txt", "md", "csv"];

/** Lays out plain text on Letter pages (no external dependencies). */
export async function textToPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10.5;
  const lineH = size * 1.45;
  const [W, H, M] = [612, 792, 60];
  const maxW = W - M * 2;
  const safe = (s: string) =>
    [...s.replace(/\t/g, "    ")]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return "?";
        }
      })
      .join("");
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = safe(raw).split(/(\s+)/);
    let cur = "";
    for (const w of words) {
      if (font.widthOfTextAtSize(cur + w, size) > maxW && cur.trim()) {
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      } else cur += w;
      while (font.widthOfTextAtSize(cur, size) > maxW) {
        let cut = cur.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(cur.slice(0, cut), size) > maxW) cut--;
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      }
    }
    lines.push(cur);
  }
  const perPage = Math.floor((H - M * 2) / lineH);
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
    const page = doc.addPage([W, H]);
    lines.slice(i, i + perPage).forEach((l, j) => l && page.drawText(l, { x: M, y: H - M - (j + 1) * lineH + 4, size, font, color: rgb(0.1, 0.1, 0.1) }));
  }
  return Buffer.from(await doc.save());
}

export function extOf(name: string) {
  return (name.split(".").pop() || "").toLowerCase();
}

async function sofficePath(): Promise<string | null> {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  for (const p of ["/usr/bin/soffice", "/usr/local/bin/soffice", "/opt/homebrew/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"]) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

/** Converts an office document to PDF with LibreOffice (headless). */
export async function officeToPdf(data: Buffer, ext: string): Promise<Buffer> {
  const bin = await sofficePath();
  if (!bin) throw badRequest("Office conversion isn't available on this server (LibreOffice not installed). Upload a PDF instead.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdftek-"));
  try {
    const input = path.join(dir, `input.${ext}`);
    await fs.writeFile(input, data);
    await execFileAsync(
      bin,
      [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--convert-to", "pdf", "--outdir", dir, input],
      { timeout: 120_000 },
    );
    return await fs.readFile(path.join(dir, "input.pdf"));
  } catch (err) {
    console.error("[pdftek] office conversion failed", err);
    throw badRequest("We couldn't convert that file to PDF. Check that it isn't password-protected or corrupted.");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Converts a PDF to an Office format with LibreOffice. */
export async function pdfToOffice(data: Buffer, target: "docx"): Promise<Buffer> {
  const bin = await sofficePath();
  if (!bin) throw badRequest("Server-side conversion isn't available.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdftek-"));
  try {
    const input = path.join(dir, "input.pdf");
    await fs.writeFile(input, data);
    await execFileAsync(
      bin,
      [
        `-env:UserInstallation=file://${path.join(dir, "profile")}`,
        "--headless",
        "--infilter=writer_pdf_import",
        "--convert-to",
        `${target}:MS Word 2007 XML`,
        "--outdir",
        dir,
        input,
      ],
      { timeout: 180_000 },
    );
    return await fs.readFile(path.join(dir, `input.${target}`));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

let officeProbe: Promise<boolean> | null = null;
/** True only when LibreOffice can actually open documents (core-only installs can't). */
export function hasServerOffice(): Promise<boolean> {
  officeProbe ??= (async () => {
    const bin = await sofficePath();
    if (!bin) return false;
    try {
      await officeToPdf(Buffer.from("{\\rtf1 probe}"), "rtf");
      return true;
    } catch {
      return false;
    }
  })();
  return officeProbe;
}

/** Builds a PDF where each image becomes one page sized to the image (max A4-ish at 72dpi scale). */
export async function imagesToPdf(images: { data: Uint8Array; type: "jpg" | "png" }[], pageSize: "fit" | "a4" | "letter" = "fit") {
  const doc = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.type === "png" ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
    if (pageSize === "fit") {
      const scale = Math.min(1, 1200 / Math.max(embedded.width, embedded.height));
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      const page = doc.addPage([w, h]);
      page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    } else {
      const [pw, ph] = pageSize === "a4" ? [595.28, 841.89] : [612, 792];
      const page = doc.addPage([pw, ph]);
      const margin = 24;
      const s = Math.min((pw - margin * 2) / embedded.width, (ph - margin * 2) / embedded.height);
      const w = embedded.width * s;
      const h = embedded.height * s;
      page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return Buffer.from(await doc.save());
}

export async function normalizeToPdf(name: string, data: Buffer): Promise<{ pdf: Buffer; sourceType: string }> {
  const ext = extOf(name);
  if (ext === "pdf" || data.subarray(0, 5).toString() === "%PDF-") {
    try {
      const doc = await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
      if (doc.getPageCount() === 0) throw badRequest("That PDF has no pages.");
    } catch (err) {
      if (err instanceof Error && /encrypt/i.test(err.message)) {
        throw badRequest("That PDF is password-protected. Remove the password and upload it again.");
      }
      if (err instanceof Error && "status" in err) throw err;
      throw badRequest("That file doesn't look like a valid PDF.");
    }
    return { pdf: data, sourceType: "pdf" };
  }
  if (IMAGE_EXT.includes(ext)) {
    return { pdf: await imagesToPdf([{ data, type: ext === "png" ? "png" : "jpg" }], "fit"), sourceType: "image" };
  }
  if (TEXT_EXT.includes(ext)) {
    return { pdf: await textToPdf(data.toString("utf8")), sourceType: ext };
  }
  if (OFFICE_EXT.includes(ext)) {
    return { pdf: await officeToPdf(data, ext), sourceType: ext };
  }
  throw badRequest(`.${ext || "unknown"} files aren't supported. Upload PDF, Office documents, text, or JPG/PNG images.`);
}

// ---------- page operations ----------

export async function pageCount(data: Uint8Array) {
  return (await PDFDocument.load(data, { updateMetadata: false })).getPageCount();
}

export async function mergePdfs(files: Uint8Array[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(f, { updateMetadata: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return Buffer.from(await out.save());
}

/** Parses "1-3, 5, 8-" style ranges into 0-based page indices. */
export function parseRanges(spec: string, total: number): number[] {
  const out: number[] = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m) throw badRequest(`Couldn't read page range "${part}".`);
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = m[2] ? (m[3] ? parseInt(m[3], 10) : total) : a;
    if (a < 1 || b > total || a > b) throw badRequest(`Page range "${part}" is outside 1–${total}.`);
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  if (!out.length) throw badRequest("Enter at least one page.");
  return out;
}

/** Builds a new PDF with pages in the given order (0-based), optionally rotating each. */
export async function rebuildPages(data: Uint8Array, order: { index: number; rotate?: number }[]): Promise<Buffer> {
  const src = await PDFDocument.load(data, { updateMetadata: false });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    order.map((o) => o.index),
  );
  copied.forEach((p, i) => {
    const r = order[i].rotate ?? 0;
    if (r) p.setRotation(degrees((p.getRotation().angle + r + 360) % 360));
    out.addPage(p);
  });
  return Buffer.from(await out.save());
}

export async function watermark(data: Uint8Array, text: string, opacity = 0.15): Promise<Buffer> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / Math.max(6, text.length * 0.55);
    const tw = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4),
      y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4),
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
      opacity,
      rotate: degrees(45),
    });
  }
  return Buffer.from(await doc.save());
}

export async function pageNumbers(
  data: Uint8Array,
  opts: { position: "bottom-center" | "bottom-right" | "top-right"; format: string; start: number },
): Promise<Buffer> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const label = opts.format
      .replace(/\{n(?::(\d+))?\}/g, (_m, pad?: string) => String(i + opts.start).padStart(pad ? Number(pad) : 0, "0"))
      .replace("{total}", String(pages.length + opts.start - 1));
    const size = 9;
    const tw = font.widthOfTextAtSize(label, size);
    const x = opts.position === "bottom-center" ? width / 2 - tw / 2 : width - 36 - tw;
    const y = opts.position === "top-right" ? height - 28 : 22;
    page.drawText(label, { x, y, size, font, color: rgb(0.3, 0.3, 0.3) });
  });
  return Buffer.from(await doc.save());
}

/** Re-saves with object streams and drops metadata; helps for bloated PDFs produced by some tools. */
export async function optimize(data: Uint8Array): Promise<Buffer> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  doc.setProducer("pdftek");
  doc.setCreator("pdftek");
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

export async function setMetadata(data: Uint8Array, meta: { title?: string; author?: string; subject?: string }) {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  if (meta.title !== undefined) doc.setTitle(meta.title);
  if (meta.author !== undefined) doc.setAuthor(meta.author);
  if (meta.subject !== undefined) doc.setSubject(meta.subject);
  return Buffer.from(await doc.save());
}

export const tmpName = () => id();
