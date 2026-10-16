import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FrameAnchorType,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  Packer,
  LineRuleType,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type ISectionOptions,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";
import { RULE_ROOM, analyzePdf, bulletRest, findLinks, isRightAligned, pieces, type Block, type PageLayout, type Piece, type Rule, type Seg } from "./pdf-layout";

/**
 * PDF → editable Word document made of real, flowing paragraphs: original fonts (mapped to
 * Office equivalents when needed), sizes, bold/italic, text color, centered lines, indents,
 * hanging bullets, right-aligned columns via tab stops, divider rules as paragraph borders,
 * clickable links, and each page's size and margins.
 */

const PT = 20; // twips per point

export async function pdfToDocx(bytes: Uint8Array, title: string): Promise<Buffer> {
  const pages = await analyzePdf(bytes);
  const counts = new Map<string, number>();
  for (const p of pages) for (const l of p.lines) for (const s of l.segs) for (const r of s.runs) counts.set(r.font, (counts.get(r.font) ?? 0) + r.str.length);
  const base = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Calibri";
  const out = new Document({
    creator: "pdftek",
    title,
    styles: { default: { document: { run: { font: base, size: 22 }, paragraph: { spacing: { after: 0, line: 240 } } } } },
    sections: pages.map(section),
  });
  return Packer.toBuffer(out);
}

function section(page: PageLayout): ISectionOptions {
  const margin = {
    top: Math.round(page.topMargin * PT),
    bottom: Math.round(page.bottomMargin * PT),
    left: Math.round(page.leftMargin * PT),
    right: Math.round(Math.max(18, page.width - page.rightEdge) * PT),
  };
  const size = { width: Math.round(page.width * PT), height: Math.round(page.height * PT) };
  if (page.background) return framedSection(page, size);
  const children = page.blocks.map((b) => paragraph(b, page));
  if (!page.blocks.length) {
    return {
      properties: { page: { size, margin } },
      children: [new Paragraph({ children: [new TextRun({ text: `[Page ${page.number} has no text layer. Run OCR in pdftek, then convert again.]`, italics: true, color: "888888" })] })],
    };
  }
  return { properties: { page: { size, margin } }, children };
}

function border(r: Rule): IBorderOptions {
  return { style: BorderStyle.SINGLE, size: Math.max(4, Math.min(24, Math.round(r.thickness * 8))), color: r.color.toUpperCase(), space: RULE_ROOM };
}

function runsOf(list: Piece[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const p of list) {
    const opts = { font: p.font, size: Math.round(p.size * 2), bold: p.bold, italics: p.italic, color: p.color.toUpperCase() };
    let cursor = 0;
    for (const l of findLinks(p.text)) {
      if (l.start > cursor) out.push(new TextRun({ ...opts, text: p.text.slice(cursor, l.start) }));
      out.push(new ExternalHyperlink({ link: l.url, children: [new TextRun({ ...opts, text: p.text.slice(l.start, l.end) })] }));
      cursor = l.end;
    }
    if (cursor < p.text.length) out.push(new TextRun({ ...opts, text: p.text.slice(cursor) }));
  }
  return out;
}

function paragraph(b: Block, page: PageLayout, leading: ParagraphChild[] = []): Paragraph {
  const textWidth = page.rightEdge - page.leftMargin;
  const children: ParagraphChild[] = [...leading];
  const tabStops: { type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }[] = [];
  const addSegs = (segs: Seg[], firstSeg: Seg, lineIndex: number) => {
    segs.forEach((seg, si) => {
      if (si > 0) {
        children.push(new TextRun({ children: [new Tab()] }));
        const right = si === segs.length - 1 && isRightAligned(seg, page);
        const pos = Math.round((right ? textWidth : seg.x - page.leftMargin) * PT);
        if (!tabStops.some((t) => t.position === pos)) tabStops.push({ type: right ? TabStopType.RIGHT : TabStopType.LEFT, position: pos });
      }
      children.push(...runsOf(pieces(si === 0 ? firstSeg : seg, { trimStart: si === 0 && (lineIndex > 0 || firstSeg !== seg) })));
    });
  };

  if (b.kind === "bullet" && b.bullet) {
    const g = b.bullet;
    children.push(new TextRun({ text: g.glyph, font: g.run.font, size: Math.round(g.run.size * 2), color: g.run.color.toUpperCase() }));
    children.push(new TextRun({ children: [new Tab()] }));
    tabStops.push({ type: TabStopType.LEFT, position: Math.round(g.textIndent * PT) });
    addSegs(b.lines[0].segs, bulletRest(b), 0);
  } else addSegs(b.lines[0].segs, b.lines[0].segs[0], 0);

  b.lines.slice(1).forEach((line, i) => {
    children.push(new TextRun({ text: " " }));
    addSegs(line.segs, line.segs[0], i + 1);
  });

  const indent = b.centered
    ? undefined
    : b.kind === "bullet"
      ? { left: Math.round(b.indent * PT), hanging: Math.round((b.indent - b.firstIndent) * PT) }
      : { left: Math.round(Math.min(b.firstIndent, b.indent) * PT), firstLine: Math.round(Math.max(0, b.firstIndent - b.indent) * PT) };

  return new Paragraph({
    children,
    alignment: b.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
    indent,
    tabStops: tabStops.length ? tabStops : undefined,
    // Exact line pitch taken from the PDF keeps the page's vertical rhythm (and page breaks) intact.
    spacing: { before: Math.round(b.spaceBefore * PT), after: 0, line: Math.round(b.lineHeight * PT), lineRule: LineRuleType.EXACT },
    border: b.ruleBelow || b.ruleAbove ? { bottom: b.ruleBelow ? border(b.ruleBelow) : undefined, top: b.ruleAbove ? border(b.ruleAbove) : undefined } : undefined,
  });
}


// ---------- positioned layout for OCR'd pages ----------

type FrameGroup = { x: number; end: number; size: number; lines: { y: number; seg: Seg }[] };

/**
 * OCR'd pages keep their graphics as a background image, so the text must land exactly where it
 * was. Each column block becomes an absolutely positioned, fully editable frame (w:framePr), with
 * the original line breaks and line pitch; the background image sits behind everything.
 */
function framedSection(page: PageLayout, size: { width: number; height: number }): ISectionOptions {
  const segs = page.lines.flatMap((l) => l.segs.map((seg) => ({ y: l.y, seg, size: Math.max(...seg.runs.map((r) => r.size)) })));
  segs.sort((a, b) => a.y - b.y || a.seg.x - b.seg.x);
  const groups: FrameGroup[] = [];
  for (const s of segs) {
    const g = groups.find((g) => {
      const last = g.lines[g.lines.length - 1];
      return Math.abs(g.x - s.seg.x) < Math.max(2, s.size * 0.6) && s.y - last.y > 0 && s.y - last.y <= s.size * 2 && Math.abs(g.size - s.size) < 0.6;
    });
    if (g) {
      g.lines.push({ y: s.y, seg: s.seg });
      g.end = Math.max(g.end, s.seg.end);
    } else groups.push({ x: s.seg.x, end: s.seg.end, size: s.size, lines: [{ y: s.y, seg: s.seg }] });
  }

  const bg = new ImageRun({
    type: page.background!.type,
    data: page.background!.data,
    transformation: { width: Math.round((page.width * 96) / 72), height: Math.round((page.height * 96) / 72) },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
      behindDocument: true,
      allowOverlap: true,
      wrap: { type: TextWrappingType.NONE },
    },
  });

  const children: Paragraph[] = [new Paragraph({ children: [bg], spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT } })];
  for (const g of groups) {
    const pitch = g.lines.length > 1 ? (g.lines[g.lines.length - 1].y - g.lines[0].y) / (g.lines.length - 1) : g.size * 1.25;
    const lineHeight = Math.max(pitch, g.size * 1.05);
    const runs: ParagraphChild[] = [];
    g.lines.forEach((l, i) => {
      if (i > 0) runs.push(new TextRun({ break: 1 }));
      runs.push(...runsOf(pieces(l.seg, { trimStart: true })));
    });
    // With exact line spacing, the baseline sits about 80% down the line box.
    const top = g.lines[0].y - lineHeight * 0.8;
    const width = (g.end - g.x) * 1.12 + g.size; // slack for font metric differences, so lines never re-wrap
    children.push(
      new Paragraph({
        children: runs,
        frame: {
          type: "absolute",
          position: { x: Math.round(g.x * PT), y: Math.round(top * PT) },
          width: Math.round(Math.min(width, page.width - g.x) * PT),
          height: Math.round(lineHeight * g.lines.length * PT),
          anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
          rule: HeightRule.ATLEAST,
        },
        spacing: { before: 0, after: 0, line: Math.round(lineHeight * PT), lineRule: LineRuleType.EXACT },
      }),
    );
  }
  return { properties: { page: { size, margin: { top: 0, bottom: 0, left: 0, right: 0 } } }, children };
}
