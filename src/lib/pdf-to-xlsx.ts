import "server-only";
import ExcelJS from "exceljs";
import { analyzePdf, bulletRest, findLinks, isRightAligned, linkFor, lineText, pieces, segText, type Block, type Line, type PageLayout, type Piece, type Seg } from "./pdf-layout";

/**
 * PDF → Excel that keeps the look of the document.
 *
 * Text pages become one tidy sheet (no gridlines): each paragraph is a wrapped cell with its
 * original fonts, sizes, bold/italic and color; centered lines stay centered, indents and
 * bullets are kept, right-aligned dates/locations land in their own right-aligned column,
 * divider lines become cell borders, emails/URLs are clickable, and row heights follow the
 * PDF's spacing. Pages that are mostly tables become real grids with numeric cells.
 */

// Excel column width is measured in "characters" of the default font (Calibri 11: 7px + 5px padding).

type RichText = ExcelJS.RichText;

function rich(list: Piece[]): RichText[] {
  return list.map((p) => ({
    text: p.text,
    font: { name: p.font, size: round1(p.size), bold: p.bold || undefined, italic: p.italic || undefined, color: { argb: `FF${p.color.toUpperCase()}` } },
  }));
}
const round1 = (n: number) => Math.round(n * 2) / 2;
const widthChars = (pt: number) => Math.max(1, Math.round((((pt * 96) / 72 - 5) / 7) * 0.94 * 10) / 10);

export async function pdfToXlsx(bytes: Uint8Array, title: string): Promise<Buffer> {
  const pages = await analyzePdf(bytes);
  const wb = new ExcelJS.Workbook();
  wb.creator = "pdftek";
  wb.title = title;

  // Simple flowing documents (letters, résumés) → one tidy sheet of paragraphs. Multi-column
  // layouts (receipts, forms, OCR'd scans) → positioned layout sheets. Tables → numeric grids.
  const kind = (p: PageLayout) => (p.tabular ? "table" : p.ocr || isMultiColumn(p) ? "layout" : "text");
  const textPages = pages.filter((p) => kind(p) === "text");
  if (textPages.length) documentSheet(wb, textPages, textPages.length !== pages.length ? "Text" : "Document");
  for (const p of pages) {
    if (kind(p) === "layout") layoutSheet(wb, p, pages.length > 1 ? `Page ${p.number}` : "Document");
    else if (kind(p) === "table") tableSheet(wb, p);
  }
  if (!pages.some((p) => p.blocks.length)) {
    const ws = wb.worksheets[0] ?? wb.addWorksheet("Document");
    ws.getCell("A1").value = "This PDF has no text layer. Run OCR in pdftek, then convert again.";
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- text documents ----------

function documentSheet(wb: ExcelJS.Workbook, pages: PageLayout[], name: string) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  const first = pages[0];
  const textWidth = Math.max(...pages.map((p) => p.rightEdge - p.leftMargin));

  // Width of the right-hand column: widest right-aligned trailing segment on any page.
  let rightW = 0;
  for (const p of pages)
    for (const b of p.blocks)
      for (const l of b.lines) if (l.segs.length > 1 && isRightAligned(l.segs[l.segs.length - 1], p)) rightW = Math.max(rightW, l.segs[l.segs.length - 1].end - l.segs[l.segs.length - 1].x);
  const twoCols = rightW > 0;
  const colB = twoCols ? rightW + 8 : 0;
  ws.columns = twoCols ? [{ width: widthChars(textWidth - colB) }, { width: widthChars(colB) }] : [{ width: widthChars(textWidth) }];

  const isA4 = Math.abs(first.width - 595) < 8;
  ws.pageSetup = {
    paperSize: (isA4 ? 9 : undefined) as ExcelJS.PaperSize | undefined,
    orientation: first.width > first.height ? "landscape" : "portrait",
    // Columns are sized to the PDF's text width; fit-to-width guards against font metric differences.
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: first.leftMargin / 72,
      right: Math.max(0.25, (first.width - first.rightEdge) / 72),
      top: first.topMargin / 72,
      bottom: first.bottomMargin / 72,
      header: 0.2,
      footer: 0.2,
    },
  };

  let r = 1;
  pages.forEach((page, pi) => {
    for (const block of page.blocks) {
      writeBlock(ws, r, block, page, twoCols, textWidth - colB);
      r++;
    }
    if (pi < pages.length - 1 && r > 1) ws.getRow(r - 1).addPageBreak();
  });
}

function writeBlock(ws: ExcelJS.Worksheet, r: number, b: Block, page: PageLayout, twoCols: boolean, mainWidthPt: number) {
  const row = ws.getRow(r);
  const a = row.getCell(1);
  const firstLine = b.lines[0];
  const trailing = firstLine.segs.length > 1 && isRightAligned(firstLine.segs[firstLine.segs.length - 1], page) ? firstLine.segs[firstLine.segs.length - 1] : null;
  const mainSegs = trailing ? firstLine.segs.slice(0, -1) : firstLine.segs;

  // Main text: all non-trailing segments of the first line, then continuation lines.
  const parts: Piece[] = [];
  const pushSeg = (seg: Seg, sep?: string) => {
    const p = pieces(seg, { trimStart: !!sep });
    if (sep && p.length) parts.push({ ...p[0], text: sep });
    parts.push(...p);
  };
  if (b.kind === "bullet" && b.bullet) {
    parts.push({ text: `${b.bullet.glyph}  `, font: b.bullet.run.font, size: b.bullet.run.size, bold: false, italic: false, color: b.bullet.run.color });
    pushSeg(bulletRest(b));
    mainSegs.slice(1).forEach((s) => pushSeg(s, "    "));
  } else mainSegs.forEach((s, i) => pushSeg(s, i ? "    " : undefined));
  b.lines.slice(1).forEach((l: Line) => l.segs.forEach((s, i) => pushSeg(s, i ? "    " : " ")));

  const text = parts.map((p) => p.text).join("");
  // Only turn the cell into a link when the link is the point of the cell; spreadsheet apps
  // restyle hyperlink cells and would drop the formatting of a whole contact line.
  const found = linkFor(page, b.lines, text);
  const url = found && found.replace(/^mailto:/, "").length >= text.replace(/\s/g, "").length * 0.6 ? found : undefined;
  // ExcelJS accepts rich text inside a hyperlink value at runtime; its typings only allow plain strings.
  a.value = url ? ({ text: { richText: rich(parts) }, hyperlink: url } as unknown as ExcelJS.CellHyperlinkValue) : { richText: rich(parts) };

  const indentPt = b.centered ? 0 : b.kind === "bullet" ? b.firstIndent : Math.min(b.firstIndent, b.indent);
  a.alignment = {
    horizontal: b.centered ? "center" : "left",
    vertical: "bottom",
    wrapText: true,
    indent: indentPt >= 6 ? Math.min(15, Math.round(indentPt / 9)) : undefined,
  };

  if (twoCols) {
    if (trailing) {
      const c = row.getCell(2);
      c.value = { richText: rich(pieces(trailing)) };
      c.alignment = { horizontal: "right", vertical: "bottom" };
    } else {
      ws.mergeCells(r, 1, r, 2);
    }
  }

  // Row height: the PDF's own line count and spacing, plus room for the space above.
  const size = Math.max(...b.lines.map((l) => l.size));
  // The column is as wide as the PDF's text column, so the PDF's own line count is the best estimate.
  // Cells can be a little narrower than the PDF column, so allow for an extra wrapped line when text is long.
  const cellWidthPt = (twoCols && !trailing ? mainWidthPt + colBPt(ws) : mainWidthPt) - indentPt - 8;
  // Measured widths from the PDF (excluding the right-hand column) tell us how much text the cell holds.
  const textPt = b.lines.reduce((w, l, i) => {
    const segs = i === 0 ? mainSegs : l.segs;
    return w + (segs.length ? segs[segs.length - 1].end - segs[0].x : 0);
  }, 0);
  const estimatedLines = Math.max(b.lines.length, Math.ceil((textPt * 1.03) / Math.max(40, cellWidthPt)));
  row.height = Math.min(409, Math.round((estimatedLines * Math.max(b.lineHeight, size * 1.2) + Math.min(b.spaceBefore, 30) + 1) * 4) / 4);

  const rule = b.ruleBelow;
  if (rule) {
    const style: ExcelJS.BorderStyle = rule.thickness >= 1.5 ? "medium" : "thin";
    for (let c = 1; c <= (twoCols ? 2 : 1); c++) row.getCell(c).border = { bottom: { style, color: { argb: `FF${rule.color.toUpperCase()}` } } };
  }
  if (b.ruleAbove) {
    for (let c = 1; c <= (twoCols ? 2 : 1); c++) row.getCell(c).border = { ...row.getCell(c).border, top: { style: "thin", color: { argb: `FF${b.ruleAbove.color.toUpperCase()}` } } };
  }
}

/** Width of column B in points (0 when the sheet has a single column). */
function colBPt(ws: ExcelJS.Worksheet) {
  const w = ws.getColumn(2).width;
  return w ? ((w / 0.94) * 7 + 5) * 0.75 : 0;
}


// ---------- tables ----------

const NUM = /^\(?-?[$€£¥]?\s?\d{1,3}(,\d{3})*(\.\d+)?%?\)?$|^\(?-?[$€£¥]?\s?\d+(\.\d+)?%?\)?$/;

function tableSheet(wb: ExcelJS.Workbook, page: PageLayout) {
  const ws = wb.addWorksheet(`Table p.${page.number}`, { views: [{ showGridLines: true }] });
  // Column anchors from segment start positions across the page.
  const xs = page.lines.flatMap((l) => l.segs.map((s) => s.x)).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const x of xs) if (!anchors.length || x - anchors[anchors.length - 1] > 14) anchors.push(x);
  const colOf = (seg: Seg) => {
    // Right-aligned numbers anchor on their right edge; snap to the nearest column start before it.
    let idx = 0;
    for (let i = 0; i < anchors.length; i++) if (anchors[i] <= seg.x + 4) idx = i;
    return idx;
  };
  const widths = anchors.map(() => 6);

  page.lines.forEach((line, li) => {
    const row = ws.getRow(li + 1);
    for (const seg of line.segs) {
      const ci = colOf(seg);
      const cell = row.getCell(ci + 1);
      const text = segText(seg);
      const p = pieces(seg);
      const raw = text.replace(/\s/g, "");
      if (NUM.test(raw)) {
        const neg = raw.startsWith("(") || raw.startsWith("-");
        const pct = raw.endsWith("%") || raw.endsWith("%)");
        const n = Number(raw.replace(/[()$€£¥,%-]/g, "")) * (neg ? -1 : 1);
        const decimals = (raw.split(".")[1] ?? "").replace(/\D/g, "").length;
        cell.value = pct ? Number((n / 100).toFixed(decimals + 2)) : n;
        cell.numFmt = pct ? `0${decimals ? "." + "0".repeat(decimals) : ""}%` : `#,##0${decimals ? "." + "0".repeat(decimals) : ""};(#,##0${decimals ? "." + "0".repeat(decimals) : ""})`;
        cell.font = { name: p[0]?.font, size: round1(p[0]?.size ?? 10), bold: p[0]?.bold };
        cell.alignment = { horizontal: "right" };
      } else {
        cell.value = p.length > 1 ? { richText: rich(p) } : text;
        if (p.length === 1) cell.font = { name: p[0].font, size: round1(p[0].size), bold: p[0].bold, italic: p[0].italic };
      }
      widths[ci] = Math.max(widths[ci], widthChars(seg.end - seg.x + 10));
    }
    const rule = page.rules.find((r) => r.y > line.y && r.y < (page.lines[li + 1]?.y ?? Infinity) - (page.lines[li + 1]?.size ?? 0) * 0.6);
    if (rule) for (let c = 1; c <= anchors.length; c++) row.getCell(c).border = { bottom: { style: "thin", color: { argb: `FF${rule.color.toUpperCase()}` } } };
  });
  ws.columns = widths.map((w) => ({ width: Math.min(80, w) }));
  if (!page.lines.length) ws.getCell("A1").value = lineText({ y: 0, size: 0, segs: [], left: 0, right: 0 }) || "(empty page)";
}


// ---------- positioned layouts (receipts, forms, OCR'd pages) ----------

/** Many lines split into side-by-side columns that aren't just a right-aligned date. */
function isMultiColumn(p: PageLayout) {
  const multi = p.lines.filter((l) => l.segs.length >= 2 && !(l.segs.length === 2 && isRightAligned(l.segs[1], p))).length;
  return p.lines.length >= 6 && multi / p.lines.length >= 0.2;
}

function layoutSheet(wb: ExcelJS.Workbook, page: PageLayout, name: string) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  if (!page.lines.length) {
    ws.getCell("A1").value = "This page has no recognizable text.";
    return;
  }
  // Column boundaries at every distinct segment start across the page.
  const xs = page.lines.flatMap((l) => l.segs.map((s) => s.x)).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const x of xs) if (!anchors.length || x - anchors[anchors.length - 1] > 10) anchors.push(x);
  const left = Math.min(anchors[0], page.leftMargin);
  const bounds = [left, ...anchors.slice(1), Math.max(page.rightEdge, anchors[anchors.length - 1] + 20)];
  ws.columns = bounds.slice(0, -1).map((b, i) => ({ width: widthChars(bounds[i + 1] - b) }));
  const colOf = (x: number) => {
    let idx = 0;
    for (let i = 1; i < bounds.length - 1; i++) if (bounds[i] <= x + 3) idx = i;
    return idx + 1;
  };

  ws.pageSetup = {
    paperSize: (Math.abs(page.width - 595) < 8 ? 9 : undefined) as ExcelJS.PaperSize | undefined,
    orientation: page.width > page.height ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: left / 72, right: Math.max(0.25, (page.width - page.rightEdge) / 72), top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };

  let prevY = page.lines[0].y - page.lines[0].size * 1.3;
  page.lines.forEach((line, i) => {
    const row = ws.getRow(i + 1);
    // Row height reproduces the distance from the previous baseline.
    row.height = Math.min(409, Math.max(line.size * 1.15, Math.round((line.y - prevY) * 4) / 4));
    prevY = line.y;
    for (const seg of line.segs) {
      const cell = row.getCell(colOf(seg.x));
      const p = pieces(seg);
      const text = p.map((x) => x.text).join("");
      // Link only cells that are themselves an address; spreadsheet apps restyle hyperlink cells.
      const found = findLinks(text)[0];
      const url = found?.url;
      const useLink = found && found.end - found.start >= text.trim().length * 0.6;
      cell.value = useLink ? ({ text: { richText: rich(p) }, hyperlink: url } as unknown as ExcelJS.CellHyperlinkValue) : { richText: rich(p) };
      cell.alignment = { vertical: "bottom", wrapText: false };
      const bg = seg.runs.find((r) => r.bg)?.bg;
      if (bg && !isLight(bg)) {
        // Colored band behind the text (e.g. a dark header bar): fill the whole row across the page.
        for (let c = 1; c < bounds.length; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg.toUpperCase()}` } };
      }
    }
    const rule = page.rules.find((r) => r.y > line.y && r.y < (page.lines[i + 1]?.y ?? Infinity) - (page.lines[i + 1]?.size ?? 0) * 0.6);
    if (rule) for (let c = colOf(rule.x0); c <= colOf(rule.x1); c++) row.getCell(c).border = { bottom: { style: "thin", color: { argb: `FF${rule.color.toUpperCase()}` } } };
  });
}

const isLight = (hex: string) => {
  const n = parseInt(hex, 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 600;
};
