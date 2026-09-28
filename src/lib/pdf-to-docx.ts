import "server-only";
import path from "node:path";
import { AlignmentType, Document, Packer, Paragraph, Tab, TabStopType, TextRun, type ISectionOptions } from "docx";

/**
 * Converts a PDF into an editable Word document made of real, flowing paragraphs.
 *
 * pdf.js gives us positioned text runs with their fonts; we rebuild lines, detect
 * paragraphs, alignment, indentation, bullets and right-aligned columns (tab stops),
 * and keep each page's size and margins as its own section.
 */

type Item = { str: string; x: number; y: number; w: number; size: number; font: string; bold: boolean; italic: boolean };
type Seg = { x: number; end: number; runs: Item[] };
type Line = { y: number; size: number; segs: Seg[]; left: number; right: number };

const BULLET = /^[•●▪◦‣■□►▶✓✔\-–—*]\s*$/;
const BULLET_START = /^[•●▪◦‣■□►▶✓✔]/;
const PT = 20; // twips per point

export async function pdfToDocx(bytes: Uint8Array, title: string): Promise<Buffer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
    verbosity: 0,
  }).promise;

  const sections: ISectionOptions[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      await page.getOperatorList(); // loads fonts so their real names are available
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str) continue;
        const t = it.transform as number[];
        // Viewport coordinates handle page rotation and crop-box offsets; y grows downward.
        const [x, y] = vp.convertToViewportPoint(t[4], t[5]) as [number, number];
        const size = Math.hypot(t[2], t[3]) || it.height || 10;
        const raw = fontName(page, it.fontName);
        // pdf.js folds inter-column gaps into a trailing space; measure only the visible glyphs.
        const visible = it.str.trimEnd().length;
        items.push({
          str: it.str,
          x,
          y,
          w: visible ? (it.width * visible) / it.str.length : 0, // whitespace spacers carry no visible width
          size,
          font: family(raw),
          bold: /bold|black|heavy|semibold|demi/i.test(raw),
          italic: /italic|oblique/i.test(raw),
        });
      }
      sections.push(buildSection(items, vp.width, vp.height, p));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  const out = new Document({
    creator: "pdftek",
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections,
  });
  return Packer.toBuffer(out);
}

function fontName(page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } }, id: string): string {
  try {
    if (page.commonObjs.has(id)) {
      const f = page.commonObjs.get(id) as { name?: string; loadedName?: string } | null;
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
};

/** "ABCDEF+EBGaramond-Bold" → "EB Garamond", "ArialMT" → "Arial", "TimesNewRomanPS-BoldMT" → "Times New Roman". */
function family(raw: string): string {
  if (!raw) return "Calibri";
  let base = raw.split(/[-,]/)[0].replace(/(PSMT|PS|MT)$/, "").replace(/(Bold|Italic|Oblique|Regular|Light|Medium|Semibold|SemiBold|Black)+$/i, "");
  if (FAMILY_MAP[base]) return FAMILY_MAP[base];
  base = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  return base || "Calibri";
}

function buildSection(items: Item[], width: number, height: number, pageNo: number): ISectionOptions {
  const lines = toLines(items);
  if (!lines.length) {
    return {
      properties: { page: { size: { width: width * PT, height: height * PT }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [new Paragraph({ children: [new TextRun({ text: `[Page ${pageNo} has no text layer. Run OCR in pdftek, then convert again.]`, italics: true, color: "888888" })] })],
    };
  }

  const leftMargin = clamp(Math.min(...lines.map((l) => l.left)), 18, width / 3);
  const rightEdge = clamp(Math.max(...lines.map((l) => l.right)), width * 0.5, width - 12);
  const rightMargin = Math.max(18, width - rightEdge);
  const topMargin = clamp(lines[0].y - lines[0].size, 12, height / 3);
  const bottomMargin = clamp(height - lines[lines.length - 1].y - lines[lines.length - 1].size, 12, height / 3);
  const textWidth = rightEdge - leftMargin;
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];

  const children: Paragraph[] = [];
  let para: { lines: Line[] } | null = null;
  let prevBottom = topMargin; // y of the previous paragraph's last baseline

  const flush = () => {
    if (!para) return;
    const first = para.lines[0];
    const gap = first.y - prevBottom - first.size * 1.2;
    children.push(renderParagraph(para.lines, { leftMargin, rightEdge, textWidth, spaceBefore: children.length ? clamp(gap, 0, 48) : 0 }));
    prevBottom = para.lines[para.lines.length - 1].y;
    para = null;
  };

  for (const line of lines) {
    const prev: Line | undefined = para?.lines[para.lines.length - 1];
    const canMerge =
      prev &&
      prev.segs.length === 1 &&
      line.segs.length === 1 &&
      Math.abs(prev.size - line.size) < 0.6 &&
      styleOf(prev) === styleOf(line) &&
      line.y - prev.y < line.size * 1.75 &&
      line.y - prev.y > 0 &&
      prev.right - leftMargin > textWidth * 0.72 &&
      !startsBullet(line) &&
      Math.abs(line.left - para!.lines[para!.lines.length === 1 && startsBullet(para!.lines[0]) ? 0 : para!.lines.length - 1].left) < line.size * 2.5 &&
      !isCentered(prev, leftMargin, rightEdge) &&
      line.size <= body * 1.15;
    if (canMerge) para!.lines.push(line);
    else {
      flush();
      para = { lines: [line] };
    }
  }
  flush();

  return {
    properties: {
      page: {
        size: { width: Math.round(width * PT), height: Math.round(height * PT) },
        margin: {
          top: Math.round(topMargin * PT),
          bottom: Math.round(bottomMargin * PT),
          left: Math.round(leftMargin * PT),
          right: Math.round(rightMargin * PT),
        },
      },
    },
    children,
  };
}

function toLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; items: Item[] }[] = [];
  for (const it of sorted) {
    if (!it.str.trim() && !lines.length) continue;
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.45));
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
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
        // A wide horizontal gap starts a new column/segment (e.g. dates pushed to the right edge).
        if (last && it.x - last.end > Math.max(size * 2.2, 18) && it.str.trim()) segs.push({ x: it.x, end: it.x + it.w, runs: [it] });
        else if (last) {
          last.runs.push(it);
          last.end = Math.max(last.end, it.x + it.w);
        } else if (it.str.trim()) segs.push({ x: it.x, end: it.x + it.w, runs: [it] });
      }
      return { y: l.y, size, segs, left: segs[0].x, right: segs[segs.length - 1].end };
    })
    .filter((l): l is Line => !!l)
    .sort((a, b) => a.y - b.y);
}

const styleOf = (l: Line) => {
  const r = l.segs[0].runs.find((x) => x.str.trim()) ?? l.segs[0].runs[0];
  return `${r.font}|${r.bold}|${r.italic}`;
};
const startsBullet = (l: Line) => BULLET_START.test(l.segs[0].runs.map((r) => r.str).join("").trimStart());
const isCentered = (l: Line, leftMargin: number, rightEdge: number) => {
  const lpad = l.left - leftMargin;
  const rpad = rightEdge - l.right;
  return l.segs.length === 1 && lpad > 24 && Math.abs(lpad - rpad) < Math.max(8, (rightEdge - leftMargin) * 0.03);
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function runsFor(seg: Seg, trimStart: boolean): TextRun[] {
  const out: { text: string; r: Item }[] = [];
  let end = -1;
  for (const r of seg.runs) {
    let text = r.str;
    if (end >= 0 && r.x - end > r.size * 0.18 && !text.startsWith(" ") && !(out[out.length - 1]?.text.endsWith(" "))) text = " " + text;
    const last = out[out.length - 1];
    if (last && last.r.font === r.font && last.r.bold === r.bold && last.r.italic === r.italic && Math.abs(last.r.size - r.size) < 0.3) last.text += text;
    else out.push({ text, r });
    end = r.x + r.w;
  }
  if (trimStart && out[0]) out[0].text = out[0].text.trimStart();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  return out
    .filter((o) => o.text.length)
    .map((o) => new TextRun({ text: o.text.replace(/\s+/g, " "), bold: o.r.bold, italics: o.r.italic, font: o.r.font, size: Math.round(o.r.size * 2) }));
}

function renderParagraph(lines: Line[], ctx: { leftMargin: number; rightEdge: number; textWidth: number; spaceBefore: number }): Paragraph {
  const first = lines[0];
  const centered = lines.length === 1 && isCentered(first, ctx.leftMargin, ctx.rightEdge);
  const indentLeft = Math.max(0, (lines.length > 1 ? lines[1].left : first.left) - ctx.leftMargin);
  const firstIndent = Math.max(0, first.left - ctx.leftMargin);
  const children: TextRun[] = [];
  const tabStops: { type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }[] = [];

  lines.forEach((line, li) => {
    if (li > 0) children.push(new TextRun({ text: " " }));
    line.segs.forEach((seg, si) => {
      if (si > 0) {
        children.push(new TextRun({ children: [new Tab()] }));
        const isLast = si === line.segs.length - 1;
        const rightAligned = isLast && ctx.rightEdge - seg.end < 12;
        const pos = rightAligned ? ctx.textWidth : seg.x - ctx.leftMargin;
        tabStops.push({ type: rightAligned ? TabStopType.RIGHT : TabStopType.LEFT, position: Math.round(pos * PT) });
      }
      // A lone bullet glyph followed by a gap becomes "• " + text instead of a tab.
      children.push(...runsFor(seg, li > 0 && si === 0));
    });
  });

  // Collapse "•<tab>text" produced by bullet glyphs that sit in their own column.
  const bulletOnly = first.segs.length > 1 && BULLET.test(first.segs[0].runs.map((r) => r.str).join(""));
  if (bulletOnly) {
    const textStart = first.segs[1].x - ctx.leftMargin;
    return new Paragraph({
      children,
      tabStops: tabStops.map((t, i) => (i === 0 ? { type: TabStopType.LEFT, position: Math.round(textStart * PT) } : t)),
      indent: { left: Math.round(textStart * PT), hanging: Math.round((textStart - firstIndent) * PT) },
      spacing: { before: Math.round(ctx.spaceBefore * PT), after: 0 },
    });
  }

  // Inline bullet ("•" glyph then text in the same column): hang the text after a tab.
  if (startsBullet(first) && !centered) {
    const runs = first.segs[0].runs;
    const bi = runs.findIndex((r) => r.str.trim());
    const glyph = runs[bi].str.trim()[0];
    const afterGlyph = runs[bi].str.trimStart().slice(1).trim();
    const textRun = afterGlyph ? undefined : runs.slice(bi + 1).find((r) => r.str.trim());
    const textX = textRun ? textRun.x : first.left + first.size * 1.2;
    const left = Math.max(textX - ctx.leftMargin, firstIndent + 6);
    const rest: Seg = { x: textX, end: first.segs[0].end, runs: afterGlyph ? [{ ...runs[bi], str: afterGlyph }, ...runs.slice(bi + 1)] : runs.slice(bi + 1) };
    const bulletKids: TextRun[] = [new TextRun({ text: glyph, font: runs[bi].font, size: Math.round(runs[bi].size * 2) }), new TextRun({ children: [new Tab()] }), ...runsFor(rest, true)];
    lines.slice(1).forEach((line) => {
      bulletKids.push(new TextRun({ text: " " }));
      line.segs.forEach((seg, si) => {
        if (si > 0) bulletKids.push(new TextRun({ children: [new Tab()] }));
        bulletKids.push(...runsFor(seg, si === 0));
      });
    });
    return new Paragraph({
      children: bulletKids,
      tabStops: [{ type: TabStopType.LEFT, position: Math.round(left * PT) }, ...dedupeStops(tabStops)],
      indent: { left: Math.round(left * PT), hanging: Math.round((left - firstIndent) * PT) },
      spacing: { before: Math.round(ctx.spaceBefore * PT), after: 0 },
    });
  }

  const hanging = 0;
  return new Paragraph({
    children,
    tabStops: tabStops.length ? dedupeStops(tabStops) : undefined,
    alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
    indent: centered
      ? undefined
      : hanging > 0
        ? { left: Math.round(indentLeft * PT), hanging: Math.round(hanging * PT) }
        : { left: Math.round(Math.min(firstIndent, indentLeft) * PT), firstLine: Math.round(Math.max(0, firstIndent - indentLeft) * PT) },
    spacing: { before: Math.round(ctx.spaceBefore * PT), after: 0 },
  });
}

function dedupeStops<T extends { position: number }>(stops: T[]): T[] {
  const seen = new Set<number>();
  return stops.filter((s) => (seen.has(s.position) ? false : (seen.add(s.position), true)));
}
