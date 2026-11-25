import { PDFArray, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFDocument, type PDFPage } from "pdf-lib";

/**
 * Removes the original words of edited lines from a page, so an edit really replaces them instead of
 * only covering them with a white box. (Covered text stays in the file: it would still be selected,
 * copied and searched, and editing the same line again would find two overlapping lines.)
 *
 * The page's content stream is read operator by operator while following where each piece of text is
 * placed (the text and transformation matrices). A text-showing operator whose starting point lies in
 * one of the given boxes is dropped; everything else is kept exactly as it was.
 */

/** A line to remove, in page units: start x, baseline y, width and font size. */
export type TextBox = { x: number; y: number; w: number; size: number };

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const WS = new Set([" ", "\n", "\r", "\t", "\f", "\0"]);
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const SHOW = new Set(["Tj", "TJ", "'", '"']);

function skipString(s: string, i: number) {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return s.length;
}
function skipArray(s: string, i: number) {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "(") i = skipString(s, i) - 1;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i + 1;
  }
  return s.length;
}
function skipDict(s: string, i: number) {
  let depth = 0;
  for (; i < s.length; i++) {
    if (s.startsWith("<<", i)) (depth++, i++);
    else if (s.startsWith(">>", i)) {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    } else if (s[i] === "(") i = skipString(s, i) - 1;
  }
  return s.length;
}

/** Where an inline image's data ends (after "EI"). */
function inlineImageEnd(s: string, from: number) {
  const id = /\sID[\s\0]/g;
  id.lastIndex = from;
  const hit = id.exec(s);
  if (!hit) return s.length;
  const dict = s.slice(from, hit.index);
  const data = hit.index + hit[0].length;
  const num = (re: RegExp) => Number(re.exec(dict)?.[1]);
  if (!/\/(F|Filter)\b/.test(dict)) {
    const w = num(/\/(?:W|Width)\s+(\d+)/);
    const h = num(/\/(?:H|Height)\s+(\d+)/);
    const mask = /\/(?:IM|ImageMask)\s+true/.test(dict);
    const bpc = mask ? 1 : num(/\/(?:BPC|BitsPerComponent)\s+(\d+)/);
    const cs = /\/(?:CS|ColorSpace)\s*\/(\w+)/.exec(dict)?.[1] ?? "";
    const comps = mask ? 1 : ({ G: 1, DeviceGray: 1, RGB: 3, DeviceRGB: 3, CMYK: 4, DeviceCMYK: 4, I: 1, Indexed: 1 } as Record<string, number>)[cs] ?? 0;
    if (w > 0 && h > 0 && bpc > 0 && comps > 0) {
      let end = data + Math.ceil((w * comps * bpc) / 8) * h;
      while (end < s.length && WS.has(s[end])) end++;
      if (s.startsWith("EI", end)) return end + 2;
    }
  }
  const m = /[\s\0]EI(?=[\s\0]|$)/g;
  m.lastIndex = data;
  const e = m.exec(s);
  return e ? e.index + e[0].length : s.length;
}

/** Returns the content with matching text removed, and how many text operators were removed. */
export function removeTextIn(src: string, boxes: TextBox[]): { out: string; removed: number } {
  const out: string[] = [];
  let operands: string[] = [];
  let ctm: M = [...I];
  const stack: M[] = [];
  let tm: M = [...I];
  let tlm: M = [...I];
  let leading = 0;
  let removed = 0;
  // A show operator right after a removed one, with no new position in between, continues the same
  // line (the text cursor moved by the removed text's width, which isn't known here): remove it too.
  let lastRemoved = false;
  let i = 0;
  const n = src.length;

  const inBox = () => {
    const m = mul(tm, ctm);
    const [x, y] = [m[4], m[5]];
    return boxes.some((b) => x >= b.x - Math.max(1, b.size * 0.15) && x <= b.x + Math.max(b.w - b.size * 0.2, 1) && Math.abs(y - b.y) <= Math.max(1.2, b.size * 0.35));
  };
  const moveTo = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = [...tlm];
    lastRemoved = false;
  };

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
      i = src[i + 1] === "<" ? skipDict(src, i) : src.indexOf(">", i) + 1 || n;
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
      const end = inlineImageEnd(src, i);
      out.push(src.slice(start, end));
      operands = [];
      i = end;
      continue;
    }
    const num = (k: number) => Number(operands[operands.length - k]) || 0;
    switch (tok) {
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? ctm;
        break;
      case "cm":
        ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm);
        break;
      case "BT":
        tm = [...I];
        tlm = [...I];
        lastRemoved = false;
        break;
      case "Tm":
        tlm = [num(6), num(5), num(4), num(3), num(2), num(1)];
        tm = [...tlm];
        lastRemoved = false;
        break;
      case "Td":
        moveTo(num(2), num(1));
        break;
      case "TD":
        leading = -num(1);
        moveTo(num(2), num(1));
        break;
      case "TL":
        leading = num(1);
        break;
      case "T*":
        moveTo(0, -leading);
        break;
    }
    if (SHOW.has(tok)) {
      if (tok === "'" || tok === '"') moveTo(0, -leading);
      if (inBox() || lastRemoved) {
        removed++;
        lastRemoved = true;
        // Keep the operators' side effects on the text state, without drawing anything.
        if (tok === "'") out.push("T*");
        else if (tok === '"' && operands.length >= 3) out.push(`${operands[0]} Tw ${operands[1]} Tc T*`);
        operands = [];
        continue;
      }
      lastRemoved = false;
    }
    out.push(operands.length ? `${operands.join(" ")} ${tok}` : tok);
    operands = [];
  }
  return { out: out.join("\n"), removed };
}

function decode(stream: PDFStream): string | null {
  try {
    const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : (stream as unknown as { getContents(): Uint8Array }).getContents();
    let s = "";
    for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return s;
  } catch {
    return null;
  }
}

/** Removes the text in `boxes` from the page's own content. Returns false if the page couldn't be read (nothing is changed). */
export function removePageText(pdf: PDFDocument, page: PDFPage, boxes: TextBox[]): boolean {
  if (!boxes.length) return true;
  const node = page.node;
  const contents = node.get(PDFName.of("Contents"));
  const resolved = contents instanceof PDFRef ? pdf.context.lookup(contents) : contents;
  const streams: PDFStream[] = [];
  if (resolved instanceof PDFStream) streams.push(resolved);
  else if (resolved instanceof PDFArray) {
    for (let k = 0; k < resolved.size(); k++) {
      const s = resolved.lookup(k);
      if (s instanceof PDFStream) streams.push(s);
    }
  }
  if (!streams.length) return true;
  const parts: string[] = [];
  for (const s of streams) {
    const d = decode(s);
    if (d === null) return false;
    parts.push(d);
  }
  const { out, removed } = removeTextIn(parts.join("\n"), boxes);
  if (!removed) return true;
  const bytes = new Uint8Array(out.length);
  for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xff;
  const ref = pdf.context.register(pdf.context.flateStream(bytes));
  node.set(PDFName.of("Contents"), pdf.context.obj([ref]));
  return true;
}
