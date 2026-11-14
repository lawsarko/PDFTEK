import "server-only";
import fs from "node:fs";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFHexString,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFField,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { FieldType, FormField, FormValues, Rect } from "./forms";
import { expandLabel, guessFromLabel, looksSensitive } from "./forms";

// ---------- reading fillable fields ----------

/**
 * The PDF's own fillable (AcroForm) fields with where they sit on the page. Labels come from the
 * field's tooltip when it has one, otherwise from its name; AI later turns these into plain
 * questions (see form-ai.ts).
 */
export async function readAcroFields(pdf: Buffer): Promise<FormField[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return [];
  }
  let fields: PDFField[];
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  const pageByRef = new Map<string, number>();
  doc.getPages().forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let j = 0; j < annots.size(); j++) {
      const r = annots.get(j);
      if (r instanceof PDFRef) pageByRef.set(r.toString(), i + 1);
    }
  });

  const out: FormField[] = [];
  let n = 0;
  for (const f of fields) {
    const name = f.getName();
    const type = acroType(f);
    if (!type) continue;
    const widgets = f.acroField.getWidgets();
    if (!widgets.length) continue;
    const located = widgets.map((w) => {
      const ref = doc.context.getObjectRef(w.dict);
      const r = w.getRectangle();
      return {
        widget: w,
        page: (ref && pageByRef.get(ref.toString())) ?? 1,
        rect: [r.x, r.y, r.width, r.height] as Rect,
      };
    });
    const label = tooltip(f) || expandLabel(humanize(name));
    const guess = type === "text" ? guessFromLabel(label) : {};
    const base = {
      label,
      acro: name,
      readOnly: f.isReadOnly() || undefined,
      required: f.isRequired() || undefined,
      sensitive: looksSensitive(`${label} ${name}`) || undefined,
    };
    if (f instanceof PDFRadioGroup) {
      const options = located.map((l) => {
        const on = l.widget.getOnValue()?.decodeText?.() ?? l.widget.getOnValue()?.toString().replace(/^\//, "") ?? "";
        return { value: on, label: on, page: l.page, rect: l.rect };
      });
      out.push({ id: `f${++n}`, page: options[0].page ?? 1, rect: options[0].rect!, type: "radio", options, ...base });
      continue;
    }
    // A field shown in several places (e.g. a name repeated on every page) is filled once.
    const first = located[0];
    const field: FormField = { id: `f${++n}`, page: first.page, rect: first.rect, type: guess.type ?? type, ...base };
    if (guess.profileKey && !base.sensitive) field.profileKey = guess.profileKey;
    if (field.type === "date") field.format = "MM/DD/YYYY";
    if (f instanceof PDFTextField) {
      const max = f.getMaxLength();
      if (max) field.maxLength = max;
      if (f.isCombed() && max) field.comb = true;
      if (f.isMultiline()) field.type = "multiline";
    }
    if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      field.options = f.getOptions().map((o) => ({ value: o, label: o }));
    }
    out.push(field);
  }
  return out.filter((f) => f.rect[2] > 2 && f.rect[3] > 2);
}

function acroType(f: PDFField): FieldType | null {
  if (f instanceof PDFTextField) return "text";
  if (f instanceof PDFCheckBox) return "checkbox";
  if (f instanceof PDFRadioGroup) return "radio";
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) return "choice";
  if (f instanceof PDFSignature) return "signature";
  return null; // push buttons
}

function tooltip(f: PDFField): string {
  const tu = f.acroField.dict.get(PDFName.of("TU"));
  if (tu instanceof PDFString || tu instanceof PDFHexString) return tu.decodeText().replace(/\s+/g, " ").trim().slice(0, 200);
  return "";
}

/** "topmostSubform[0].Page1[0].f1_01[0]" → "f1 01"; "applicant_first_name" → "Applicant first name". */
export function humanize(name: string): string {
  const last = name.split(".").pop() ?? name;
  const s = last
    .replace(/\[\d+\]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

// ---------- writing answers ----------

const FONT_PATHS = [
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
];
let fontBytes: Buffer | null | undefined;
function unicodeFontBytes() {
  if (fontBytes !== undefined) return fontBytes;
  fontBytes = null;
  for (const p of FONT_PATHS) {
    try {
      fontBytes = fs.readFileSync(p);
      break;
    } catch {}
  }
  return fontBytes;
}

type Fonts = { font: PDFFont; supports: (s: string) => string };

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  const bytes = unicodeFontBytes();
  if (bytes) {
    doc.registerFontkit(fontkit);
    // Embedded in full: subsetting has garbled glyphs in some viewers.
    const font = await doc.embedFont(bytes, { subset: false });
    const set = new Set(font.getCharacterSet());
    return { font, supports: (s) => [...s].map((c) => (set.has(c.codePointAt(0)!) || c === "\n" ? c : "?")).join("") };
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return { font, supports: (s) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?") };
}

export type Signatures = Record<string, string>; // field id → PNG data URL

/**
 * Writes the answers into the PDF: the form's own fields get their values (so the result stays a
 * proper form), and everything else is drawn on the page. Signatures are placed as images.
 * `flatten` bakes everything into the page so it can't be changed.
 */
export async function buildFilledPdf(pdf: Buffer, fields: FormField[], values: FormValues, opts: { flatten: boolean; signatures: Signatures }): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const fonts = await embedFonts(doc);
  const pages = doc.getPages();
  let form: ReturnType<PDFDocument["getForm"]> | null = null;
  try {
    form = doc.getForm();
    // Hybrid XFA forms (e.g. many government PDFs) would show the old, empty XFA layer.
    form.deleteXFA();
  } catch {
    form = null;
  }

  for (const f of fields) {
    const v = values[f.id]?.value ?? "";
    const page = pages[f.page - 1];
    if (!page) continue;

    if (f.type === "signature" || f.type === "initials") {
      const png = opts.signatures[f.id];
      if (png) await drawImage(doc, page, png, f.rect);
      continue;
    }

    const acro = f.acro && form ? safe(() => form!.getField(f.acro!)) : null;
    if (acro && !f.readOnly) {
      if (acro instanceof PDFTextField) {
        const text = fonts.supports(f.comb && f.maxLength ? v.slice(0, f.maxLength) : f.maxLength ? v.slice(0, f.maxLength) : v);
        acro.setText(text || undefined);
        fitAcroText(acro, fonts.font, text, f);
      } else if (acro instanceof PDFCheckBox) {
        if (truthy(v)) acro.check();
        else acro.uncheck();
      } else if (acro instanceof PDFRadioGroup) {
        if (v && acro.getOptions().includes(v)) acro.select(v);
      } else if (acro instanceof PDFDropdown) {
        if (v) safe(() => acro.select(v, !acro.getOptions().includes(v)));
      } else if (acro instanceof PDFOptionList) {
        if (v && acro.getOptions().includes(v)) acro.select(v);
      }
      continue;
    }

    // Drawn fields (flat or scanned forms).
    if (f.type === "checkbox") {
      if (truthy(v)) drawCheck(page, f.rect);
    } else if (f.type === "radio") {
      const opt = f.options?.find((o) => o.value === v);
      if (opt?.rect) drawCheck(pages[(opt.page ?? f.page) - 1] ?? page, opt.rect);
    } else if (v) {
      drawText(page, fonts, fonts.supports(v), f);
    }
  }

  if (form) {
    safe(() => form!.updateFieldAppearances(fonts.font));
    if (opts.flatten) safe(() => form!.flatten());
  }
  return Buffer.from(await doc.save());
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function truthy(v: string) {
  return /^(true|yes|on|1|x|✓|checked)$/i.test(v.trim());
}

function fitAcroText(field: PDFTextField, font: PDFFont, text: string, f: FormField) {
  if (!text || f.comb) return;
  const [, , w, h] = f.rect;
  if (f.type === "multiline") {
    // Largest size (10pt down to 6pt) at which the wrapped text fits the box.
    let ms = 10;
    while (ms > 6 && wrap(text, font, ms, w - 4).length * ms * 1.2 > h - 2) ms -= 0.5;
    safe(() => field.setFontSize(ms));
    return;
  }
  let size = Math.min(12, Math.max(6, h * 0.65));
  while (size > 6 && font.widthOfTextAtSize(text, size) > w - 4) size -= 0.5;
  safe(() => field.setFontSize(size));
}

function drawText(page: PDFPage, fonts: Fonts, text: string, f: FormField) {
  const [x, y, w, h] = f.rect;
  const font = fonts.font;
  const color = rgb(0.05, 0.08, 0.2);

  if (f.comb && f.maxLength) {
    const cell = w / f.maxLength;
    const size = Math.min(h * 0.7, cell * 0.9, 14);
    [...text.slice(0, f.maxLength)].forEach((ch, i) => {
      const cw = font.widthOfTextAtSize(ch, size);
      page.drawText(ch, { x: x + i * cell + (cell - cw) / 2, y: y + (h - size * 0.72) / 2, size, font, color });
    });
    return;
  }

  if (f.type === "multiline" || h > 30) {
    let size = 10;
    let lines = wrap(text, font, size, w - 4);
    while (size > 6 && lines.length * size * 1.2 > h - 2) {
      size -= 0.5;
      lines = wrap(text, font, size, w - 4);
    }
    lines.forEach((line, i) => page.drawText(line, { x: x + 2, y: y + h - size * (i + 1) * 1.2 + size * 0.2, size, font, color }));
    return;
  }

  let size = Math.min(11, Math.max(6, h * 0.68));
  while (size > 5.5 && font.widthOfTextAtSize(text, size) > w - 3) size -= 0.25;
  page.drawText(text, { x: x + 2, y: y + Math.max(1.5, (h - size * 0.72) / 2), size, font, color });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** A check mark drawn as strokes, so it works in every font. */
function drawCheck(page: PDFPage, rect: Rect) {
  const [x, y, w, h] = rect;
  const s = Math.min(w, h);
  const cx = x + (w - s) / 2;
  const cy = y + (h - s) / 2;
  const t = Math.max(1, s / 9);
  const color = rgb(0.05, 0.08, 0.2);
  page.drawLine({ start: { x: cx + s * 0.18, y: cy + s * 0.52 }, end: { x: cx + s * 0.42, y: cy + s * 0.24 }, thickness: t, color });
  page.drawLine({ start: { x: cx + s * 0.42, y: cy + s * 0.24 }, end: { x: cx + s * 0.84, y: cy + s * 0.8 }, thickness: t, color });
}

async function drawImage(doc: PDFDocument, page: PDFPage, dataUrl: string, rect: Rect) {
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!m) return;
  const bytes = Buffer.from(m[2], "base64");
  const img = m[1] === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const [x, y, w, h] = rect;
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  page.drawImage(img, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
}
