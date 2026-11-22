import "server-only";
import path from "node:path";
// fontkit's Indic and Thai shapers are compiled generators that expect this global.
import "regenerator-runtime/runtime";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  degrees,
  rgb,
  type PDFFont,
} from "pdf-lib";
import { analyzePdf, isRightAligned, segText, type Block, type Line, type PageLayout, type Seg } from "./pdf-layout";
import type { TableCell } from "./pdf-tables";
import { loadFont } from "./fonts";
import { subsetFont } from "./font-subset";
import { HttpError } from "./http";
import type { TranslateLanguage } from "./translate-languages";

/**
 * Translate PDF, keeping the layout.
 *
 * 1. The layout analyzer finds every piece of text with its position, size, weight, colour and
 *    alignment: paragraphs, table cells, columns, headers and footers (scans are OCR'd).
 * 2. Text is translated in batches (paragraphs as a whole, so sentences translate naturally).
 * 3. The original text is removed from the page's content (graphics, tables, logos and photos
 *    stay exactly as they were) and the translation is drawn in the same place, in a font that
 *    covers the target script, wrapping and shrinking slightly where a translation runs longer.
 *    Scanned pages are redrawn on a copy of the scan with its text erased.
 */

export const TRANSLATE_MAX_PAGES = 60;

type Align = "left" | "center" | "right";

type Unit = {
  page: number;
  text: string;
  /** Box in page coordinates (points, origin top-left). */
  x: number;
  top: number;
  w: number;
  h: number;
  size: number;
  bold: boolean;
  color: string;
  /** Colour behind the text, sampled from the rendered page. */
  bg?: [number, number, number];
  align: Align;
  /** Baseline-to-baseline distance as a multiple of the font size. */
  leading: number;
  /** Room the translation may grow into. */
  maxRight: number;
  maxBottom: number;
  serif: boolean;
};

export type Translator = (texts: string[], onBatch?: (done: number) => void) => Promise<string[]>;

const HAS_LETTERS = /\p{L}{2,}/u;

// ---------- 1. Units of text ----------

function seg(line: Line): Seg | null {
  return line.segs.length === 1 ? line.segs[0] : null;
}

function firstRun(lines: Line[]) {
  for (const l of lines) for (const s of l.segs) for (const r of s.runs) if (r.str.trim()) return r;
  return null;
}

function joinLines(texts: string[]): string {
  let out = "";
  for (const t of texts) {
    if (!out) out = t;
    else if (/[A-Za-zÀ-ÿ]-$/.test(out) && /^[a-zà-ÿ]/.test(t)) out = out.slice(0, -1) + t;
    else out += " " + t;
  }
  return out;
}

function unitFrom(page: PageLayout, lines: Line[], text: string, box: { x: number; right: number }, align: Align, leadingPts?: number): Unit | null {
  const run = firstRun(lines);
  if (!run || !text.trim()) return null;
  const size = Math.max(4, lines[0].size || run.size);
  const top = lines[0].y - size * 0.92;
  const last = lines[lines.length - 1];
  const bottom = last.y + last.size * 0.28;
  const leading = leadingPts && lines.length > 1 ? Math.max(1, leadingPts / size) : 1.22;
  return {
    page: page.number,
    text,
    x: box.x,
    top,
    w: Math.max(4, box.right - box.x),
    h: Math.max(size, bottom - top),
    size,
    bold: run.bold,
    color: run.color || "000000",
    align,
    leading,
    maxRight: box.right,
    maxBottom: bottom,
    serif: /times|georgia|garamond|serif|cambria|book|minion|palatino/i.test(run.font) && !/sans/i.test(run.font),
  };
}

function cellUnit(page: PageLayout, cell: TableCell): Unit | null {
  if (!cell.lines.length) return null;
  const text = joinLines(cell.lines.map((l) => l.segs.map(segText).join(" ")));
  const u = unitFrom(page, cell.lines, text, { x: cell.lines[0].left, right: cell.x1 - 2 }, "left");
  if (!u) return null;
  const right = Math.max(...cell.lines.map((l) => l.right));
  // Numbers pushed against the right border stay right-aligned.
  if (cell.x1 - right < 6 && cell.lines[0].left - cell.x0 > 8) u.align = "right";
  u.maxRight = cell.x1 - 2;
  u.maxBottom = cell.y1 - 1;
  u.w = Math.max(u.w, Math.min(cell.x1 - 2, u.maxRight) - u.x);
  return u;
}

function pageUnits(page: PageLayout): Unit[] {
  const units: Unit[] = [];
  for (const b of page.blocks as Block[]) {
    if (b.kind === "table" && b.table) {
      for (const row of b.table.rows) for (const cell of row.cells) {
        if (cell.vMerge === "continue") continue;
        const u = cellUnit(page, cell);
        if (u) units.push(u);
      }
      continue;
    }
    if (!b.lines.length) continue;
    if (b.lines.every((l) => seg(l))) {
      // A paragraph (or one-column line): translated as a whole and reflowed in its box.
      const text = joinLines(b.lines.map((l) => segText(l.segs[0])));
      const x = Math.min(...b.lines.map((l) => l.segs[0].x));
      const right = Math.max(...b.lines.map((l) => l.segs[0].end));
      const single = b.lines.length === 1;
      const align: Align = b.centered ? "center" : single && isRightAligned(b.lines[0].segs[0], page) && b.lines[0].segs[0].x > page.width / 2 ? "right" : "left";
      const u = unitFrom(page, b.lines, text, { x, right }, align, b.lineHeight);
      if (u) units.push(u);
    } else {
      // Lines split into columns (statements, schedules, forms): each piece on its own.
      for (const l of b.lines) {
        for (const s of l.segs) {
          const text = segText(s);
          const u = unitFrom(page, [{ ...l, segs: [s] }], text, { x: s.x, right: s.end }, isRightAligned(s, page) ? "right" : "left");
          if (u) units.push(u);
        }
      }
    }
  }
  // Room to grow: to the right up to the next text on the same band (or the margin), and down to
  // the next text below.
  const rightLimit = page.width - Math.max(18, Math.min(page.width - page.rightEdge, 54));
  for (const u of units) {
    if (u.align === "left") {
      let lim = Math.max(u.maxRight, rightLimit);
      for (const o of units) {
        if (o === u || o.x <= u.x + u.w - 1) continue;
        if (o.top < u.top + u.h && o.top + o.h > u.top) lim = Math.min(lim, o.x - 4);
      }
      u.maxRight = Math.max(u.x + u.w, lim);
    }
    let low = page.height - Math.max(12, page.bottomMargin * 0.5);
    for (const o of units) {
      if (o === u || o.top < u.top + u.h - 1) continue;
      if (o.x < u.x + u.w && o.x + o.w > u.x) low = Math.min(low, o.top - 1);
    }
    u.maxBottom = Math.max(u.maxBottom, Math.min(low, u.top + u.h + u.size * 6));
  }
  return units;
}

// ---------- 2. Removing the original text ----------

const WS = new Set([" ", "\n", "\r", "\t", "\f", "\0"]);
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

function skipString(s: string, i: number): number {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return s.length;
}

function skipHex(s: string, i: number): number {
  const end = s.indexOf(">", i);
  return end < 0 ? s.length : end + 1;
}

function skipArray(s: string, i: number): number {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "(") i = skipString(s, i);
    else if (c === "<" && s[i + 1] !== "<") i = skipHex(s, i);
    else if (c === "[") (depth++, i++);
    else if (c === "]") {
      i++;
      if (--depth === 0) return i;
    } else i++;
  }
  return s.length;
}

function skipDict(s: string, i: number): number {
  let depth = 0;
  while (i < s.length) {
    if (s.startsWith("<<", i)) (depth++, (i += 2));
    else if (s.startsWith(">>", i)) {
      i += 2;
      if (--depth === 0) return i;
    } else if (s[i] === "(") i = skipString(s, i);
    else i++;
  }
  return s.length;
}

/**
 * Removes the text-showing operators (Tj, TJ, ', ") from a content stream and keeps everything
 * else: paths, images, colours, clipping and text positioning. Reports whether any text that was
 * removed was visible (render mode other than 3), so scans with an invisible OCR layer can be
 * told apart from real text.
 */
export function stripTextOperators(src: string): { out: string; visible: number; invisible: number } {
  const out: string[] = [];
  let operands: string[] = [];
  let mode = 0;
  const modes: number[] = [];
  let visible = 0;
  let invisible = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === "%") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      continue;
    }
    const start = i;
    if (c === "(") {
      i = skipString(src, i);
      operands.push(src.slice(start, i));
      continue;
    }
    if (c === "<") {
      i = src[i + 1] === "<" ? skipDict(src, i) : skipHex(src, i);
      operands.push(src.slice(start, i));
      continue;
    }
    if (c === "[") {
      i = skipArray(src, i);
      operands.push(src.slice(start, i));
      continue;
    }
    if (c === "/") {
      i++;
      while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++;
      operands.push(src.slice(start, i));
      continue;
    }
    if (DELIM.has(c)) {
      i++;
      operands.push(c);
      continue;
    }
    while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++;
    const tok = src.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok) || tok === "true" || tok === "false" || tok === "null") {
      operands.push(tok);
      continue;
    }
    if (tok === "BI") {
      // Inline image: copy through "EI" untouched (its data is binary).
      const id = src.indexOf("ID", i);
      let end = id < 0 ? n : id + 3;
      const m = /\sEI(?=[\s]|$)/g;
      m.lastIndex = end;
      const hit = m.exec(src);
      end = hit ? hit.index + hit[0].length : n;
      out.push(src.slice(start, end));
      operands = [];
      i = end;
      continue;
    }
    if (tok === "Tr") mode = Number(operands[0]) || 0;
    else if (tok === "q") modes.push(mode);
    else if (tok === "Q") mode = modes.pop() ?? mode;
    if (tok === "Tj" || tok === "TJ" || tok === "'" || tok === '"') {
      if (mode === 3) invisible++;
      else visible++;
      if (tok === "'") out.push("T*");
      else if (tok === '"' && operands.length >= 2) out.push(`${operands[0]} Tw ${operands[1]} Tc T*`);
      operands = [];
      continue;
    }
    out.push(operands.length ? `${operands.join(" ")} ${tok}` : tok);
    operands = [];
  }
  return { out: out.join("\n"), visible, invisible };
}

function decode(stream: PDFStream): string | null {
  try {
    const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : (stream as unknown as { getContents(): Uint8Array }).getContents();
    return Buffer.from(bytes).toString("latin1");
  } catch {
    return null;
  }
}

/** Removes text from a page and the form XObjects it draws. Returns visible/invisible counts, or null if it couldn't. */
function stripPageText(pdf: PDFDocument, page: PDFPage, seenForms: Set<string>): { visible: number; invisible: number } | null {
  const node = page.node;
  const contents = node.get(PDFName.of("Contents"));
  const streams: PDFStream[] = [];
  const resolved = contents instanceof PDFRef ? pdf.context.lookup(contents) : contents;
  if (resolved instanceof PDFStream) streams.push(resolved);
  else if (resolved instanceof PDFArray) {
    for (let k = 0; k < resolved.size(); k++) {
      const s = resolved.lookup(k);
      if (s instanceof PDFStream) streams.push(s);
    }
  }
  if (!streams.length) return { visible: 0, invisible: 0 };
  const parts: string[] = [];
  for (const s of streams) {
    const d = decode(s);
    if (d === null) return null;
    parts.push(d);
  }
  const r = stripTextOperators(parts.join("\n"));
  // Wrap the original drawing in q/Q so its graphics state can't leak into the new text.
  const ref = pdf.context.register(pdf.context.flateStream(Buffer.from(`q\n${r.out}\nQ\n`, "latin1")));
  node.set(PDFName.of("Contents"), pdf.context.obj([ref]));
  let visible = r.visible;
  let invisible = r.invisible;
  const res = node.Resources();
  if (res) {
    const f = stripForms(pdf, res, seenForms);
    visible += f.visible;
    invisible += f.invisible;
  }
  return { visible, invisible };
}

function stripForms(pdf: PDFDocument, resources: PDFDict, seen: Set<string>): { visible: number; invisible: number } {
  let visible = 0;
  let invisible = 0;
  const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return { visible, invisible };
  for (const [, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef) || seen.has(value.toString())) continue;
    seen.add(value.toString());
    const form = pdf.context.lookup(value);
    if (!(form instanceof PDFStream) || form.dict.get(PDFName.of("Subtype"))?.toString() !== "/Form") continue;
    const d = decode(form);
    if (d === null) continue;
    const r = stripTextOperators(d);
    visible += r.visible;
    invisible += r.invisible;
    if (r.visible || r.invisible) {
      const dict = form.dict.clone(pdf.context);
      dict.delete(PDFName.of("Filter"));
      dict.delete(PDFName.of("DecodeParms"));
      dict.delete(PDFName.of("Length"));
      const entries: Record<string, unknown> = {};
      for (const [k, v] of dict.entries()) entries[k.asString().slice(1)] = v;
      pdf.context.assign(value, pdf.context.flateStream(Buffer.from(r.out, "latin1"), entries as never));
    }
    const inner = form.dict.lookupMaybe(PDFName.of("Resources"), PDFDict);
    if (inner) {
      const f = stripForms(pdf, inner, seen);
      visible += f.visible;
      invisible += f.invisible;
    }
  }
  return { visible, invisible };
}

// ---------- 3. Drawing the translation ----------

type Fonts = { regular: PDFFont; bold: PDFFont; serif?: PDFFont; serifBold?: PDFFont; fallback: PDFFont; fallbackBold: PDFFont };
type Piece = { text: string; font: PDFFont };

/**
 * Embeds a font subset to the characters the translated document uses. (pdf-lib's own subsetter
 * drops glyphs from many modern fonts, so HarfBuzz does the subsetting and the result is embedded
 * whole.) Each family is embedded once even when it serves as both primary and fallback.
 */
async function embed(pdf: PDFDocument, family: string, bold: boolean, chars: Set<number>, cache: Map<string, PDFFont | null>): Promise<PDFFont | null> {
  const key = `${family}|${bold}`;
  if (cache.has(key)) return cache.get(key)!;
  let font: PDFFont | null = null;
  const data = await loadFont(family, { bold });
  if (data) {
    const small = await subsetFont(data, chars);
    try {
      font = await pdf.embedFont(small ?? data, { subset: false, features: { liga: false, clig: false, dlig: false } });
    } catch {
      font = null;
    }
  }
  cache.set(key, font);
  return font;
}

async function loadFonts(pdf: PDFDocument, lang: TranslateLanguage, needSerif: boolean, text: string): Promise<Fonts> {
  const chars = new Set<number>([32, 0x2026]);
  for (const ch of text) chars.add(ch.codePointAt(0)!);
  for (const ch of "0123456789.,:;-–—()%$€£/") chars.add(ch.codePointAt(0)!);
  const cache = new Map<string, PDFFont | null>();
  const fallback = (await embed(pdf, "Noto Sans", false, chars, cache)) ?? (await embed(pdf, "DejaVu Sans", false, chars, cache));
  const fallbackBold = (await embed(pdf, "Noto Sans", true, chars, cache)) ?? fallback;
  const regular = (await embed(pdf, lang.font, false, chars, cache)) ?? fallback;
  const bold = (await embed(pdf, lang.font, true, chars, cache)) ?? regular;
  if (!regular || !fallback || !bold || !fallbackBold) throw new HttpError(503, "The fonts needed for this language couldn't be loaded. Please try again in a minute.");
  const out: Fonts = { regular, bold, fallback, fallbackBold };
  if (needSerif && lang.serif) {
    out.serif = (await embed(pdf, lang.serif, false, chars, cache)) ?? undefined;
    out.serifBold = (await embed(pdf, lang.serif, true, chars, cache)) ?? out.serif;
  }
  return out;
}

const charsets = new WeakMap<PDFFont, Set<number>>();
function has(font: PDFFont, cp: number) {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  return set.has(cp);
}

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** Splits text into runs drawable with one font (primary script font, Latin fallback). */
function piecesFor(text: string, primary: PDFFont, fallback: PDFFont): Piece[] {
  const out: Piece[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200b || cp === 0xad) continue;
    let font = has(primary, cp) ? primary : has(fallback, cp) ? fallback : null;
    let c = ch;
    if (!font) {
      if (/\s/.test(ch)) (c = " "), (font = has(primary, 32) ? primary : fallback);
      else continue; // a character no font here can draw
    }
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += c;
    else out.push({ text: c, font });
  }
  return out;
}

const widthOf = (ps: Piece[], size: number) => ps.reduce((w, p) => w + p.font.widthOfTextAtSize(p.text, size), 0);

/**
 * Visual order for a right-to-left line (a simplified bidi algorithm): runs of right-to-left
 * script are laid out right to left, while numbers, prices and Latin words inside them keep their
 * own left-to-right order. Neutral characters (spaces, punctuation, "$") take the direction of the
 * text around them.
 */
function visualOrder(ps: Piece[], rtl: boolean): Piece[] {
  if (!rtl || !ps.some((p) => RTL_CHAR.test(p.text))) return ps;
  const chars: { ch: string; font: PDFFont; dir: boolean | null }[] = [];
  for (const p of ps) for (const ch of p.text) chars.push({ ch, font: p.font, dir: RTL_CHAR.test(ch) ? true : /[\p{L}\p{N}]/u.test(ch) ? false : null });
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].dir !== null) continue;
    let prev: boolean | null = null;
    for (let k = i - 1; k >= 0 && prev === null; k--) prev = chars[k].dir;
    let next: boolean | null = null;
    for (let k = i + 1; k < chars.length && next === null; k++) next = chars[k].dir;
    chars[i].dir = prev !== null && prev === next ? prev : prev === false && next === null ? false : true;
  }
  const runs: { rtl: boolean; pieces: Piece[] }[] = [];
  for (const c of chars) {
    let run = runs[runs.length - 1];
    if (!run || run.rtl !== c.dir) runs.push((run = { rtl: Boolean(c.dir), pieces: [] }));
    const last = run.pieces[run.pieces.length - 1];
    if (last && last.font === c.font) last.text += c.ch;
    else run.pieces.push({ text: c.ch, font: c.font });
  }
  return runs.reverse().flatMap((r) => r.pieces);
}

function wrap(text: string, width: number, size: number, primary: PDFFont, fallback: PDFFont, noSpaces: boolean): Piece[][] {
  const lines: Piece[][] = [];
  // Break opportunities: spaces, plus between characters for scripts written without spaces.
  const tokens = noSpaces ? text.match(/[A-Za-z0-9.,%$€£¥:/@'’-]+\s*|\s+|./gu) ?? [] : text.split(/(?<=\s)/);
  let cur = "";
  const fits = (s: string) => widthOf(piecesFor(s, primary, fallback), size) <= width;
  for (const t of tokens) {
    const next = cur + t;
    if (!cur || fits(next.trimEnd())) {
      cur = next;
      continue;
    }
    lines.push(piecesFor(cur.trimEnd(), primary, fallback));
    cur = t.trimStart();
    // A single word wider than the line is split between characters.
    while (cur && !fits(cur)) {
      let k = cur.length - 1;
      while (k > 1 && !fits(cur.slice(0, k))) k--;
      lines.push(piecesFor(cur.slice(0, k), primary, fallback));
      cur = cur.slice(k);
    }
  }
  if (cur.trim()) lines.push(piecesFor(cur.trimEnd(), primary, fallback));
  return lines;
}

type Layout = { size: number; lines: Piece[][]; width: number };

function fit(u: Unit, text: string, primary: PDFFont, fallback: PDFFont, lang: TranslateLanguage): Layout {
  const oneLine = u.h < u.size * 1.7;
  const roomW = Math.max(u.w, u.maxRight - u.x);
  const roomH = Math.max(u.h, u.maxBottom - u.top);
  const min = Math.max(4, u.size * 0.55);
  // Single lines: keep them on one line, using spare room to the right, before shrinking.
  if (oneLine) {
    for (let size = u.size; size >= Math.max(4, u.size * 0.72); size -= 0.25) {
      const ps = piecesFor(text, primary, fallback);
      const w = widthOf(ps, size);
      if (w <= (u.align === "left" ? roomW : u.w + 2)) return { size, lines: [ps], width: Math.max(u.w, w) };
    }
  }
  for (let size = u.size; size >= min; size -= 0.25) {
    const width = u.align === "left" && !oneLine ? u.w + 1 : u.align === "left" ? roomW : u.w + 2;
    const lines = wrap(text, width, size, primary, fallback, Boolean(lang.noSpaces));
    const height = size * 0.92 + (lines.length - 1) * size * u.leading + size * 0.28;
    if (height <= roomH + 0.5) return { size, lines, width };
  }
  const width = u.align === "left" ? roomW : u.w + 2;
  return { size: min, lines: wrap(text, width, min, primary, fallback, Boolean(lang.noSpaces)), width };
}

function hex(c: string) {
  const v = parseInt((c || "000000").replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** Maps a point from viewport space (top-left origin, as the analyzer reports) into PDF user space. */
function mapper(page: PDFPage) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const [x0, y0, x1, y1] = [box.x, box.y, box.x + box.width, box.y + box.height];
  const pt = (vx: number, vy: number): [number, number] => {
    switch (rot) {
      case 90:
        return [vy + x0, vx + y0];
      case 180:
        return [x1 - vx, vy + y0];
      case 270:
        return [x1 - vy, y1 - vx];
      default:
        return [vx + x0, y1 - vy];
    }
  };
  return { pt, rotate: degrees(rot) };
}

function drawUnit(page: PDFPage, u: Unit, text: string, fonts: Fonts, lang: TranslateLanguage) {
  const serif = u.serif && fonts.serif;
  const primary = u.bold ? (serif ? fonts.serifBold! : fonts.bold) : serif ? fonts.serif! : fonts.regular;
  const fallback = u.bold ? fonts.fallbackBold : fonts.fallback;
  const layout = fit(u, text, primary, fallback, lang);
  const { pt, rotate } = mapper(page);
  const color = hex(u.color);
  // Right-to-left languages read from the right: left-aligned text is aligned to the right edge
  // of its box instead (where the box is wide enough to make a difference).
  const flip = Boolean(lang.rtl) && u.align === "left";
  layout.lines.forEach((line, i) => {
    const ordered = visualOrder(line, Boolean(lang.rtl));
    const w = widthOf(ordered, layout.size);
    let x = u.align === "center" ? u.x + (u.w - w) / 2 : u.align === "right" ? u.x + u.w - w : u.x;
    if (flip) x = u.x + Math.max(u.w, w) - w;
    const baseline = u.top + layout.size * 0.92 + i * layout.size * u.leading;
    for (const p of ordered) {
      const [px, py] = pt(x, baseline);
      page.drawText(p.text, { x: px, y: py, size: layout.size, font: p.font, color, rotate });
      x += p.font.widthOfTextAtSize(p.text, layout.size);
    }
  });
}

/** Draws a scanned page's text-free background image over the whole page. */
async function drawBackground(pdf: PDFDocument, page: PDFPage, layout: PageLayout, data: Buffer) {
  const img = await pdf.embedJpg(data);
  const { pt, rotate } = mapper(page);
  const [x, y] = pt(0, layout.height);
  page.drawImage(img, { x, y, width: layout.width, height: layout.height, rotate });
}

// ---------- 4. The whole job ----------

export type TranslateProgress = { stage: "reading" | "translating" | "drawing"; done: number; total: number };

export async function translatePdf(
  bytes: Uint8Array,
  opts: {
    language: TranslateLanguage;
    translate: Translator;
    onProgress?: (p: TranslateProgress) => void;
    /** Runs the memory-heavy phases (reading, drawing) one job at a time; the AI step waits outside it. */
    exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  },
): Promise<{ pdf: Buffer; pages: number; translated: number }> {
  const progress = opts.onProgress ?? (() => {});
  const exclusive = opts.exclusive ?? (<T,>(fn: () => Promise<T>) => fn());
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e))) throw new HttpError(400, "This PDF is password-protected. Remove the password first (Protect → Remove password).");
    throw new HttpError(400, "This PDF couldn't be read.");
  }
  const total = pdf.getPageCount();
  if (total > TRANSLATE_MAX_PAGES) throw new HttpError(400, `Translate PDF handles up to ${TRANSLATE_MAX_PAGES} pages at a time. Split the document first (Organize → Split).`);
  pdf.registerFontkit(fontkit);

  progress({ stage: "reading", done: 0, total });
  let pdfjsDoc: Awaited<ReturnType<typeof openPdfJs>> | null = null;
  const { layouts, units } = await exclusive(async () => {
    const layouts = await analyzePdf(bytes, { ocr: true, tables: true, ocrImages: true });
    const units = layouts.map(pageUnits);
    // The analyzer knows one text colour per page; sample each block's real text and background
    // colours from the rendered page (white headings on a coloured band, grey footers, …).
    pdfjsDoc = await openPdfJs(bytes);
    for (let p = 0; p < units.length; p++) if (units[p].length) await sampleColors(pdfjsDoc, p + 1, units[p]).catch((e) => console.error("[pdftek] translate: colour sampling failed", e));
    return { layouts, units };
  });

  // Translate every distinct text with letters; numbers, dates and codes are redrawn as they are.
  const texts = [...new Set(units.flat().map((u) => u.text).filter((t) => HAS_LETTERS.test(t)))];
  progress({ stage: "translating", done: 0, total: texts.length });
  const translated = texts.length ? await opts.translate(texts, (done) => progress({ stage: "translating", done, total: texts.length })) : [];
  const map = new Map(texts.map((t, i) => [t, translated[i]?.trim() || t]));

  return exclusive(async () => {
  const allText = units.flat().map((u) => map.get(u.text) ?? u.text).join("\n");
  const fonts = await loadFonts(pdf, opts.language, units.flat().some((u) => u.serif), allText);
  const pages = pdf.getPages();
  const seenForms = new Set<string>();

  for (let p = 0; p < pages.length; p++) {
    progress({ stage: "drawing", done: p, total });
    const page = pages[p];
    const layout = layouts[p];
    if (!layout || !units[p].length) continue;
    if (layout.ocr && layout.background) {
      // A scan: draw the scan with its text erased, then the translation on top.
      await drawBackground(pdf, page, layout, layout.background.data);
    } else {
      const stripped = stripPageText(pdf, page, seenForms);
      if (stripped && !stripped.visible && stripped.invisible) {
        // A scan with an invisible OCR text layer: the visible words are in the image.
        try {
          const { ocrPage } = await import("./pdf-ocr");
          const ocr = await ocrPage((pdfjsDoc ??= await openPdfJs(bytes)), p + 1);
          await drawBackground(pdf, page, layout, ocr.background);
        } catch (err) {
          console.error("[pdftek] translate: scan background failed", err);
        }
      } else if (!stripped) {
        // Content we couldn't rewrite: cover the original words instead.
        const { pt, rotate } = mapper(page);
        for (const u of units[p]) {
          const [x, y] = pt(u.x - 1, u.top + u.h + 1);
          const [r, g, b] = u.bg ?? [255, 255, 255];
          page.drawRectangle({ x, y, width: u.w + 2, height: u.h + 2, color: rgb(r / 255, g / 255, b / 255), rotate });
        }
      }
    }
    for (const u of units[p]) drawUnit(page, u, map.get(u.text) ?? u.text, fonts, opts.language);
  }
  await (pdfjsDoc as { destroy(): Promise<void> } | null)?.destroy();
  progress({ stage: "drawing", done: total, total });
  pdf.setModificationDate(new Date());
  return { pdf: Buffer.from(await pdf.save()), pages: total, translated: texts.length };
  });
}

type Canvas2D = { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }; fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
type CanvasFactory = { create(w: number, h: number): { canvas: { width: number; height: number }; context: Canvas2D } };

const SAMPLE_SCALE = 1.5;

/** Sets each unit's text colour (and the colour behind it) from a rendering of the page. */
async function sampleColors(doc: Awaited<ReturnType<typeof openPdfJs>>, pageNumber: number, units: Unit[]) {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: SAMPLE_SCALE });
  const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
  const { canvas, context } = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
  const W = canvas.width;
  const H = canvas.height;
  const img = context.getImageData(0, 0, W, H).data;
  const px = (x: number, y: number): [number, number, number] => {
    const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
    return [img[i], img[i + 1], img[i + 2]];
  };
  const key = (c: [number, number, number]) => ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const u of units) {
    const x0 = Math.floor(u.x * SAMPLE_SCALE);
    const x1 = Math.ceil((u.x + u.w) * SAMPLE_SCALE);
    const y0 = Math.floor(u.top * SAMPLE_SCALE);
    const y1 = Math.ceil((u.top + u.h) * SAMPLE_SCALE);
    if (x1 <= x0 || y1 <= y0) continue;
    // Background: the most common colour on a ring just outside the text box.
    const ring = new Map<number, { n: number; c: [number, number, number] }>();
    const addRing = (c: [number, number, number]) => {
      const k = key(c);
      const e = ring.get(k);
      if (e) e.n++;
      else ring.set(k, { n: 1, c });
    };
    const stepX = Math.max(1, Math.floor((x1 - x0) / 60));
    for (let x = x0 - 2; x <= x1 + 2; x += stepX) (addRing(px(x, y0 - 3)), addRing(px(x, y1 + 2)));
    for (let y = y0; y <= y1; y += Math.max(1, Math.floor((y1 - y0) / 12))) (addRing(px(x0 - 3, y)), addRing(px(x1 + 3, y)));
    const bg = [...ring.values()].sort((a, b) => b.n - a.n)[0]?.c ?? [255, 255, 255];
    // Text: the most common colour inside the box that clearly differs from the background.
    const inside = new Map<number, { n: number; sum: [number, number, number]; far: number }>();
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const c = px(x, y);
        const d = dist(c, bg);
        if (d < 90) continue;
        const k = key(c);
        const e = inside.get(k);
        if (e) (e.n++, (e.sum[0] += c[0]), (e.sum[1] += c[1]), (e.sum[2] += c[2]));
        else inside.set(k, { n: 1, sum: [...c], far: d });
      }
    }
    // Prefer well-populated colours, then the ones furthest from the background (glyph cores, not edges).
    const best = [...inside.values()].sort((a, b) => b.n * b.far - a.n * a.far)[0];
    u.bg = bg;
    if (best && best.n >= 3) {
      const c = best.sum.map((v) => Math.round(v / best.n));
      u.color = c.map((v) => v.toString(16).padStart(2, "0")).join("");
    } else {
      // Nothing sampled (very small text): pick black or white for contrast with the background.
      const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
      if (lum < 110) u.color = "ffffff";
    }
  }
  page.cleanup();
}

async function openPdfJs(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
    verbosity: 0,
    isOffscreenCanvasSupported: false,
  }).promise;
}

// ---------- AI translation ----------

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "integer" }, text: { type: "string" } } },
    },
  },
};

const BATCH_CHARS = 5000;
const BATCH_ITEMS = 80;
const PARALLEL = 3;

/** Translates texts with Claude in batches, reporting token usage for billing. */
export function aiTranslator(lang: TranslateLanguage, onUsage: (model: string, usage: { input_tokens: number; output_tokens: number }) => void): Translator {
  if (process.env.PDFTEK_FAKE_AI === "1" && process.env.NODE_ENV !== "production") return fakeTranslator(lang);
  return async (texts, onBatch) => {
    const { structured } = await import("./ai");
    const model = process.env.PDFTEK_TRANSLATE_MODEL || "claude-sonnet-5-5";
    const batches: number[][] = [];
    let cur: number[] = [];
    let chars = 0;
    texts.forEach((t, i) => {
      if (cur.length && (chars + t.length > BATCH_CHARS || cur.length >= BATCH_ITEMS)) {
        batches.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(i);
      chars += t.length;
    });
    if (cur.length) batches.push(cur);

    const out: string[] = [...texts];
    let done = 0;
    const system = `You are a professional document translator. Translate each item into ${lang.english} (${lang.native}). The items are text blocks from one document, in reading order, so keep terminology consistent and use the surrounding items as context.

Rules:
- Translate the meaning naturally, the way a native ${lang.english} professional would write it; never word for word.
- Keep unchanged: numbers, amounts, currencies, dates written in digits, codes, reference numbers, email addresses, URLs, and the names of people, companies and products.
- Keep leading bullets, list numbers and lettering, and keep punctuation such as a trailing ":".
- The translation is printed in the same space as the original, so keep it concise: about as long as the original, never longer than needed.
- If an item is already in ${lang.english}, or has nothing to translate (a name, a code), return it unchanged.
- Return only the translation for each id: no notes, quotes or explanations.${lang.code === "th" ? "\n- Insert a zero-width space (U+200B) between Thai words so lines can wrap." : ""}`;

    const runBatch = async (idx: number[]) => {
      const items = idx.map((i, k) => ({ id: k, text: texts[i] }));
      const r = await structured<{ items: { id: number; text: string }[] }>({
        system,
        content: [{ type: "text", text: `Translate these ${items.length} items into ${lang.english}. Input JSON:\n${JSON.stringify(items)}` }],
        schema: SCHEMA,
        effort: "low",
        model,
        maxTokens: 32000,
        onUsage: (m, u) => onUsage(m, u),
        tooLong: "A part of this document is too long to translate in one pass. Try splitting the PDF.",
      });
      for (const it of r.items) if (idx[it.id] !== undefined && it.text?.trim()) out[idx[it.id]] = it.text.trim();
      done += idx.length;
      onBatch?.(done);
    };
    const queue = [...batches];
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
        while (queue.length) await runBatch(queue.shift()!);
      }),
    );
    return out;
  };
}

/** Development-only stand-in (PDFTEK_FAKE_AI=1): marks text so layout can be checked without an API key. */
function fakeTranslator(lang: TranslateLanguage): Translator {
  const SAMPLE: Record<string, string> = {
    ja: "これは翻訳されたテキストです",
    "zh-cn": "这是翻译后的文本内容",
    ko: "번역된 텍스트입니다",
    ar: "هذا نص مترجم من المستند",
    he: "זהו טקסט מתורגם",
    hi: "यह अनुवादित पाठ है",
    th: "นี่คือข้อความที่แปลแล้ว",
    ru: "Это переведённый текст",
    el: "Αυτό είναι μεταφρασμένο κείμενο",
  };
  return async (texts, onBatch) => {
    const out = texts.map((t) => {
      const sample = SAMPLE[lang.code];
      if (!sample) return `${t.replace(/\b(the|and|of|to|for|with)\b/gi, (w) => ({ the: "el", and: "y", of: "de", to: "a", for: "para", with: "con" })[w.toLowerCase()] ?? w)} ✓`;
      let s = "";
      while (s.length < t.length * 0.7) s += sample + " ";
      return (/^\d/.test(t) ? t.split(" ")[0] + " " : "") + s.trim() + " 2026";
    });
    onBatch?.(texts.length);
    return out;
  };
}
