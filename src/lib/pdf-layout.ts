import "server-only";
import path from "node:path";

/**
 * Layout analysis shared by the Word and Excel exporters.
 *
 * Reads positioned text runs (with real font names, weight, style and color), horizontal
 * rules drawn as thin filled/stroked paths, and link annotations, then groups text into
 * lines, column segments and paragraph blocks. Coordinates are page points with the origin
 * at the top-left (y grows downward).
 */

export type Run = { str: string; x: number; y: number; w: number; size: number; font: string; bold: boolean; italic: boolean; color: string };
export type Seg = { x: number; end: number; runs: Run[] };
export type Line = { y: number; size: number; segs: Seg[]; left: number; right: number };
export type Rule = { x0: number; x1: number; y: number; thickness: number; color: string };
export type Link = { x0: number; y0: number; x1: number; y1: number; url: string };

export type Block = {
  lines: Line[];
  kind: "text" | "bullet";
  centered: boolean;
  /** Indent of the first line and of continuation lines, from the page's left text margin. */
  firstIndent: number;
  indent: number;
  /** For bullets: the glyph and where the text after it starts (from the left margin). */
  bullet?: { glyph: string; run: Run; textIndent: number };
  spaceBefore: number;
  /** Baseline-to-baseline distance in points (the PDF's line pitch). */
  lineHeight: number;
  /** A horizontal rule sits directly below this block. */
  ruleBelow?: Rule;
  /** A horizontal rule sits directly above this block (only set for the first block). */
  ruleAbove?: Rule;
};

export type PageLayout = {
  number: number;
  width: number;
  height: number;
  lines: Line[];
  blocks: Block[];
  rules: Rule[];
  links: Link[];
  leftMargin: number;
  rightEdge: number;
  topMargin: number;
  bottomMargin: number;
  bodySize: number;
  /** Typical line pitch as a multiple of font size. */
  lineRatio: number;
  /** Most lines have three or more aligned columns (statements, schedules, tables). */
  tabular: boolean;
};

/** Vertical room a divider takes when rendered as a paragraph border (border spacing + line). */
export const RULE_ROOM = 2;

const BULLET_START = /^[•●▪◦‣■□►▶✓✔➢➤❖♦◆◇○◉⦿→·*]/;
const SYMBOL_FONT = /symbol|wingding|dingbat|webding/i;

export async function analyzePdf(bytes: Uint8Array): Promise<PageLayout[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const OPS = pdfjs.OPS;
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
    verbosity: 0,
  }).promise;

  const pages: PageLayout[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList(); // also loads fonts so their real names resolve

      // ---- walk drawing operators: text colors and horizontal rules ----
      const textColors: string[] = [];
      const rules: Rule[] = [];
      let fill = "000000";
      let stroke = "000000";
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack: { fill: string; stroke: string; ctm: number[] }[] = [];
      let pending: number[] | null = null; // bbox of the last constructed path (x0,y0,x1,y1)
      let lineWidth = 1;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        switch (fn) {
          case OPS.save:
            stack.push({ fill, stroke, ctm: [...ctm] });
            break;
          case OPS.restore: {
            const s = stack.pop();
            if (s) ({ fill, stroke, ctm } = s);
            break;
          }
          case OPS.transform:
            ctm = mul(ctm, args as number[]);
            break;
          case OPS.setFillRGBColor:
            fill = toHex(args);
            break;
          case OPS.setStrokeRGBColor:
            stroke = toHex(args);
            break;
          case OPS.setFillGray:
            fill = toHex([Number(args[0]) * 255, Number(args[0]) * 255, Number(args[0]) * 255]);
            break;
          case OPS.setLineWidth:
            lineWidth = Number(args[0]) || 1;
            break;
          case OPS.showText:
          case OPS.showSpacedText:
            textColors.push(fill);
            break;
          case OPS.constructPath: {
            const mm = args[2] as ArrayLike<number> | undefined;
            pending = mm && mm.length >= 4 ? [mm[0], mm[1], mm[2], mm[3]] : null;
            break;
          }
          case OPS.fill:
          case OPS.eoFill:
          case OPS.fillStroke:
          case OPS.eoFillStroke:
          case OPS.stroke:
          case OPS.closeStroke: {
            if (!pending) break;
            const stroked = fn === OPS.stroke || fn === OPS.closeStroke;
            const [a, b] = apply(ctm, pending[0], pending[1]);
            const [c, d] = apply(ctm, pending[2], pending[3]);
            const [vx0, vy0] = vp.convertToViewportPoint(Math.min(a, c), Math.min(b, d)) as [number, number];
            const [vx1, vy1] = vp.convertToViewportPoint(Math.max(a, c), Math.max(b, d)) as [number, number];
            const w = Math.abs(vx1 - vx0);
            const h = Math.abs(vy1 - vy0) + (stroked ? lineWidth : 0);
            const color = stroked ? stroke : fill;
            // Thin, wide, non-white shapes read as horizontal rules / dividers.
            if (w > 60 && h < 4 && color !== "ffffff" && w < vp.width * 0.99) {
              rules.push({ x0: Math.min(vx0, vx1), x1: Math.max(vx0, vx1), y: (vy0 + vy1) / 2, thickness: Math.max(0.5, h), color });
            }
            pending = null;
            break;
          }
          case OPS.endPath:
            pending = null;
            break;
        }
      }
      const dominantColor = mode(textColors.filter((c) => c !== "ffffff")) ?? "000000";

      // ---- text runs ----
      const content = await page.getTextContent();
      const runs: Run[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str) continue;
        const t = it.transform as number[];
        const [x, y] = vp.convertToViewportPoint(t[4], t[5]) as [number, number];
        const size = Math.hypot(t[2], t[3]) || it.height || 10;
        const raw = fontName(page, it.fontName);
        const visible = it.str.trimEnd().length;
        runs.push({
          str: it.str,
          x,
          y,
          // pdf.js folds inter-column gaps into whitespace spacers; they carry no visible width.
          w: visible ? (it.width * visible) / it.str.length : 0,
          size,
          font: officeFont(family(raw)),
          bold: /bold|black|heavy|semibold|demi/i.test(raw),
          italic: /italic|oblique/i.test(raw),
          color: dominantColor,
        });
      }

      // ---- links ----
      const links: Link[] = [];
      for (const a of await page.getAnnotations()) {
        const ann = a as { subtype?: string; url?: string; rect?: number[] };
        if (ann.subtype !== "Link" || !ann.url || !ann.rect) continue;
        const [x0, y0] = vp.convertToViewportPoint(ann.rect[0], ann.rect[3]) as [number, number];
        const [x1, y1] = vp.convertToViewportPoint(ann.rect[2], ann.rect[1]) as [number, number];
        links.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), url: ann.url });
      }

      pages.push(layoutPage(p, vp.width, vp.height, runs, dedupeRules(rules), links));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

// ---------- geometry helpers ----------

function mul(m: number[], n: number[]) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;

function toHex(args: unknown): string {
  if (typeof args === "string") return args.replace("#", "").toLowerCase();
  const a = args as ArrayLike<number | string>;
  if (typeof a[0] === "string") return String(a[0]).replace("#", "").toLowerCase();
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(Number(a[i]) || 0))).toString(16).padStart(2, "0")).join("");
}

function mode<T>(list: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let n = 0;
  for (const v of list) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > n) {
      n = c;
      best = v;
    }
  }
  return best;
}

function dedupeRules(rules: Rule[]): Rule[] {
  const out: Rule[] = [];
  for (const r of rules.sort((a, b) => a.y - b.y)) {
    const near = out.find((o) => Math.abs(o.y - r.y) < 3 && r.x0 < o.x1 && r.x1 > o.x0);
    if (near) {
      near.x0 = Math.min(near.x0, r.x0);
      near.x1 = Math.max(near.x1, r.x1);
      near.thickness = Math.max(near.thickness, r.thickness);
    } else out.push({ ...r });
  }
  return out;
}

// ---------- fonts ----------

function fontName(page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } }, id: string): string {
  try {
    if (page.commonObjs.has(id)) {
      const f = page.commonObjs.get(id) as { name?: string } | null;
      if (f?.name) return f.name.replace(/^[A-Z]{6}\+/, "");
    }
  } catch {}
  return "";
}

const FAMILY_MAP: Record<string, string> = {
  Helvetica: "Arial",
  Arial: "Arial",
  Times: "Times New Roman",
  TimesNewRoman: "Times New Roman",
  Courier: "Courier New",
  CourierNew: "Courier New",
  Symbol: "Symbol",
  ZapfDingbats: "Wingdings",
  SegoeUISymbol: "Segoe UI Symbol",
};

/** "ABCDEF+EB Garamond,Bold" → "EB Garamond", "ArialMT" → "Arial", "TimesNewRomanPS-BoldMT" → "Times New Roman". */
export function family(raw: string): string {
  if (!raw) return "Calibri";
  let base = raw
    .split(/[-,]/)[0]
    .replace(/(PSMT|PS|MT)$/, "")
    .replace(/(Bold|Italic|Oblique|Regular|Light|Medium|Semibold|SemiBold|Black|Roman)+$/i, "")
    .trim();
  if (FAMILY_MAP[base.replace(/\s/g, "")]) return FAMILY_MAP[base.replace(/\s/g, "")];
  if (!/\s/.test(base)) base = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return base.trim() || "Calibri";
}

/**
 * Web fonts embedded in PDFs are usually missing on the reader's machine, and Word/Excel then
 * substitute unpredictably. Map popular ones to a close font that ships with Microsoft Office.
 */
const OFFICE_EQUIVALENT: [RegExp, string][] = [
  [/garamond|cormorant/i, "Garamond"],
  [/palatino|pala/i, "Palatino Linotype"],
  [/baskerville|crimson|libre caslon|caslon|minion|sabon|spectral|lora|merriweather|playfair|pt serif|noto serif|source serif|georgia/i, "Georgia"],
  [/book antiqua|antiqua/i, "Book Antiqua"],
  [/roboto|open sans|lato|inter|source sans|nunito|montserrat|poppins|raleway|work sans|noto sans|helvetica neue|segoe ui(?! symbol)|sf pro/i, "Calibri"],
  [/roboto mono|source code|fira (mono|code)|jetbrains|menlo|consolas|monaco/i, "Consolas"],
];

export function officeFont(name: string): string {
  if (/^(Arial|Calibri|Cambria|Candara|Consolas|Constantia|Corbel|Georgia|Garamond|Tahoma|Verdana|Times New Roman|Courier New|Segoe UI Symbol|Symbol|Wingdings|Palatino Linotype|Book Antiqua|Century Gothic|Trebuchet MS|Aptos)$/i.test(name)) return name;
  for (const [re, office] of OFFICE_EQUIVALENT) if (re.test(name)) return office;
  return name;
}

// ---------- lines, segments, blocks ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function toLines(items: Run[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; items: Run[] }[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.45));
    if (line) line.items.push(it);
    else if (it.str.trim()) lines.push({ y: it.y, items: [it] });
  }
  return lines
    .map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x);
      const visible = its.filter((i) => i.str.trim());
      if (!visible.length) return null;
      const size = Math.max(...visible.map((i) => i.size));
      const segs: Seg[] = [];
      for (const it of its) {
        const last = segs[segs.length - 1];
        if (!it.str.trim()) {
          if (last) last.runs.push(it); // spacer: keep the space, don't extend the segment
          continue;
        }
        if (last && it.x - last.end > Math.max(size * 2.2, 18)) segs.push({ x: it.x, end: it.x + it.w, runs: [it] });
        else if (last) {
          last.runs.push(it);
          last.end = Math.max(last.end, it.x + it.w);
        } else segs.push({ x: it.x, end: it.x + it.w, runs: [it] });
      }
      segs.forEach((s) => {
        while (s.runs.length && !s.runs[s.runs.length - 1].str.trim()) s.runs.pop();
      });
      return { y: l.y, size, segs, left: segs[0].x, right: segs[segs.length - 1].end };
    })
    .filter((l): l is Line => !!l)
    .sort((a, b) => a.y - b.y);
}

export const lineText = (l: Line) => l.segs.map((s) => segText(s)).join("\t");
export function segText(s: Seg): string {
  let out = "";
  let end = -1;
  for (const r of s.runs) {
    if (end >= 0 && r.x - end > r.size * 0.18 && !out.endsWith(" ") && !r.str.startsWith(" ")) out += " ";
    out += r.str;
    end = r.x + (r.w || 0);
  }
  return out.replace(/\s+/g, " ").trim();
}

const styleKey = (l: Line) => {
  // Ignore a leading bullet glyph (often set in a symbol font) when comparing styles.
  const visible = l.segs[0].runs.filter((x) => x.str.trim());
  const r = (visible.length > 1 && (SYMBOL_FONT.test(visible[0].font) || BULLET_START.test(visible[0].str.trim())) ? visible[1] : visible[0]) ?? l.segs[0].runs[0];
  return `${r.font}|${r.bold}|${r.italic}`;
};
/** A line starts with a bullet glyph, or with a lone character set in a symbol font (Wingdings-style bullets). */
const startsBullet = (l: Line) => {
  const first = l.segs[0].runs.find((r) => r.str.trim());
  if (!first) return false;
  if (SYMBOL_FONT.test(first.font) && first.str.trim().length <= 2) return true;
  return BULLET_START.test(segText(l.segs[0])) && !/^[*·]\S/.test(segText(l.segs[0]));
};

function isCentered(l: Line, leftMargin: number, rightEdge: number) {
  const lpad = l.left - leftMargin;
  const rpad = rightEdge - l.right;
  return l.segs.length === 1 && lpad > 24 && Math.abs(lpad - rpad) < Math.max(8, (rightEdge - leftMargin) * 0.03);
}

function layoutPage(number: number, width: number, height: number, runs: Run[], rules: Rule[], links: Link[]): PageLayout {
  const lines = toLines(runs);
  if (!lines.length) {
    return { number, width, height, lines, blocks: [], rules, links, leftMargin: 72, rightEdge: width - 72, topMargin: 72, bottomMargin: 72, bodySize: 11, lineRatio: 1.2, tabular: false };
  }
  const leftMargin = clamp(Math.min(...lines.map((l) => l.left), ...rules.map((r) => r.x0)), 12, width / 3);
  const rightEdge = clamp(Math.max(...lines.map((l) => l.right), ...rules.map((r) => r.x1)), width * 0.5, width - 12);
  const topMargin = clamp(lines[0].y - lines[0].size * 1.1, 12, height / 3);
  const last = lines[lines.length - 1];
  // Leave slack below the last baseline: word processors reserve a full line box, and a hair of
  // extra height must never push a page's last line onto a new page (each PDF page is its own section).
  const bottomMargin = clamp(height - last.y - last.size * 1.2 - 18, 10, height / 3);
  const textWidth = rightEdge - leftMargin;
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)];
  const tabular = lines.length >= 4 && lines.filter((l) => l.segs.length >= 3).length / lines.length >= 0.4;

  // Group lines into paragraph blocks.
  const groups: Line[][] = [];
  for (const line of lines) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    const bulletGroup = g && startsBullet(g[0]);
    const contLeft = g && (g.length > 1 ? g[1].left : bulletGroup ? bulletTextX(g[0]) : g[0].left);
    const ruleBetween = prev && rules.some((r) => r.y > prev.y && r.y < line.y - line.size * 0.6);
    const canMerge =
      prev &&
      !ruleBetween &&
      prev.segs.length === 1 &&
      line.segs.length === 1 &&
      Math.abs(prev.size - line.size) < 0.6 &&
      styleKey(prev) === styleKey(line) &&
      line.y - prev.y > 0 &&
      line.y - prev.y < line.size * 1.75 &&
      prev.right - leftMargin > textWidth * 0.7 &&
      !startsBullet(line) &&
      contLeft !== undefined &&
      Math.abs(line.left - contLeft) < line.size * 2.5 &&
      !isCentered(prev, leftMargin, rightEdge) &&
      line.size <= bodySize * 1.15;
    if (canMerge) g.push(line);
    else groups.push([line]);
  }

  // Line pitch measured from wrapped paragraphs (baseline to baseline, relative to font size).
  const ratios: number[] = [];
  for (const g of groups) for (let k = 1; k < g.length; k++) ratios.push((g[k].y - g[k - 1].y) / g[k].size);
  ratios.sort((a, b) => a - b);
  const lineRatio = clamp(ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1.2, 1.05, 2.2);

  let prevY: number | null = null;
  const blocks: Block[] = groups.map((g, i) => {
    const first = g[0];
    const own = g.length > 1 ? (g[g.length - 1].y - first.y) / (g.length - 1) : first.size * lineRatio;
    let lineHeight = clamp(own, first.size * 1.05, first.size * 2.4);
    // Extra space above = distance from the previous baseline minus one line of this block.
    let gap = prevY === null ? 0 : first.y - prevY - lineHeight;
    if (gap < 0 && g.length === 1 && prevY !== null) {
      // Tightly stacked single lines (title over employer): tighten this line instead of adding space.
      lineHeight = Math.max(first.size * 1.05, first.y - prevY);
      gap = 0;
    }
    prevY = g[g.length - 1].y;
    const centered = g.length === 1 && isCentered(first, leftMargin, rightEdge);
    const firstIndent = Math.max(0, first.left - leftMargin);
    const block: Block = {
      lines: g,
      kind: "text",
      centered,
      firstIndent,
      indent: Math.max(0, (g.length > 1 ? g[1].left : first.left) - leftMargin),
      spaceBefore: i === 0 ? 0 : clamp(gap, 0, 72),
      lineHeight,
    };
    if (startsBullet(first) && !centered) {
      const runsInFirst = first.segs[0].runs;
      const bi = runsInFirst.findIndex((r) => r.str.trim());
      block.kind = "bullet";
      const tx = bulletTextX(first);
      block.bullet = { glyph: runsInFirst[bi].str.trim()[0], run: runsInFirst[bi], textIndent: Math.max(tx - leftMargin, firstIndent + 6) };
      block.indent = block.bullet.textIndent;
    }
    return block;
  });

  // Attach rules to the nearest block above (or the first block, for a rule above everything).
  for (const r of rules) {
    let above: Block | undefined;
    for (const b of blocks) if (b.lines[b.lines.length - 1].y < r.y) above = b;
    if (above) above.ruleBelow ??= r;
    else if (blocks[0]) blocks[0].ruleAbove ??= r;
  }

  // A rule rendered as a paragraph/cell border takes its own vertical room; don't count it twice.
  blocks.forEach((b, i) => {
    if (b.ruleBelow && blocks[i + 1]) blocks[i + 1].spaceBefore = Math.max(0, blocks[i + 1].spaceBefore - (RULE_ROOM + b.ruleBelow.thickness));
  });

  return { number, width, height, lines, blocks, rules, links, leftMargin, rightEdge, topMargin, bottomMargin, bodySize, lineRatio, tabular };
}

function bulletTextX(first: Line): number {
  const runs = first.segs[0].runs;
  const bi = runs.findIndex((r) => r.str.trim());
  const afterGlyph = runs[bi].str.trimStart().slice(1).trim();
  if (afterGlyph) return runs[bi].x + runs[bi].size * 0.9;
  const textRun = runs.slice(bi + 1).find((r) => r.str.trim());
  return textRun ? textRun.x : first.left + first.size * 1.2;
}

/** Text of a bullet block's first segment without the glyph. */
export function bulletRest(block: Block): Seg {
  const first = block.lines[0].segs[0];
  const runs = first.runs;
  const bi = runs.findIndex((r) => r.str.trim());
  const afterGlyph = runs[bi].str.trimStart().slice(1).trim();
  const rest = afterGlyph ? [{ ...runs[bi], str: afterGlyph }, ...runs.slice(bi + 1)] : runs.slice(bi + 1);
  while (rest.length && !rest[0].str.trim()) rest.shift();
  return { x: rest[0]?.x ?? first.x, end: first.end, runs: rest };
}

/** Styled pieces of a segment: adjacent runs with identical formatting are merged. */
export type Piece = { text: string; font: string; size: number; bold: boolean; italic: boolean; color: string };
export function pieces(seg: Seg, opts: { trimStart?: boolean } = {}): Piece[] {
  const out: Piece[] = [];
  let end = -1;
  for (const r of seg.runs) {
    let text = r.str;
    if (end >= 0 && r.x - end > r.size * 0.18 && !text.startsWith(" ") && !out[out.length - 1]?.text.endsWith(" ")) text = " " + text;
    const last = out[out.length - 1];
    if (last && last.font === r.font && last.bold === r.bold && last.italic === r.italic && Math.abs(last.size - r.size) < 0.3 && last.color === r.color) last.text += text;
    else out.push({ text, font: r.font, size: r.size, bold: r.bold, italic: r.italic, color: r.color });
    if (r.w) end = r.x + r.w;
  }
  out.forEach((p) => (p.text = p.text.replace(/\s+/g, " ")));
  if (opts.trimStart && out[0]) out[0].text = out[0].text.trimStart();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  return out.filter((p) => p.text.length);
}

/** Right-aligned trailing segment (e.g. dates or locations pushed to the right margin). */
export function isRightAligned(seg: Seg, page: PageLayout) {
  return page.rightEdge - seg.end < 12;
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

/** Finds a link for a block: a PDF link annotation over it, or an email/URL in its text. */
export function linkFor(page: PageLayout, lines: Line[], text: string): string | undefined {
  const top = lines[0].y - lines[0].size;
  const bottom = lines[lines.length - 1].y + lines[lines.length - 1].size * 0.3;
  const ann = page.links.find((l) => l.y1 >= top && l.y0 <= bottom);
  if (ann) return ann.url;
  const m = text.match(URL_RE);
  if (!m) return undefined;
  const v = m[1].replace(/[.,;)]+$/, "");
  if (v.includes("@") && !/^https?:/i.test(v)) return `mailto:${v.toLowerCase()}`;
  return /^https?:/i.test(v) ? v : `https://${v.toLowerCase()}`;
}

export function findLinks(text: string): { start: number; end: number; url: string }[] {
  const out: { start: number; end: number; url: string }[] = [];
  const re = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = m[1].replace(/[.,;)]+$/, "");
    const url = v.includes("@") && !/^https?:/i.test(v) ? `mailto:${v.toLowerCase()}` : /^https?:/i.test(v) ? v : `https://${v.toLowerCase()}`;
    out.push({ start: m.index, end: m.index + v.length, url });
  }
  return out;
}
