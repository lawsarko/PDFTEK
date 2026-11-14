import "server-only";
import { get, insert } from "./db";
import { now } from "./ids";
import { HttpError } from "./http";
import { rateLimit, type Ctx } from "./auth";
import { assertAiCredits, chargeAi, tierOf, workspaceCanUseAi } from "./billing";
import { jpegBlock, structured, type AiContent, type UsageHook } from "./ai";
import { DERIVED_KEYS, PROFILE_FIELDS, looksSensitive, type FieldType, type FormField, type FormSummary, type FormValues, type ProfileData, type Rect } from "./forms";

/**
 * The AI half of the form filler:
 *   detectFields  – reads flat or scanned forms from page images (plus lines and boxes found in the
 *                   PDF drawing) and returns every place to write, tick or sign;
 *   labelFields   – turns a fillable PDF's cryptic field names into plain questions with help text;
 *   smartFill     – answers fields from the person's profile, their instructions and supporting
 *                   documents, saying where each answer came from and how sure it is.
 */

// ---------- access & billing ----------

/**
 * AI form features use credits. To let everyone feel the magic once, each workspace gets one form
 * a month free (detection and filling on that document cost nothing).
 */
export function formAi(ctx: Ctx, documentId: string, ip: string): UsageHook {
  const month = new Date().toISOString().slice(0, 7);
  const free = get<{ document_id: string }>("SELECT document_id FROM form_free_uses WHERE workspace_id = ? AND month = ?", ctx.workspace.id, month);
  const charge: UsageHook = (model, usage) => chargeAi(ctx, model, usage, "AI form filler");
  if (free?.document_id === documentId) return () => {};
  if (tierOf(ctx) === "admin" || workspaceCanUseAi(ctx.workspace.id)) return charge;
  if (!free) {
    // New guest sessions are cheap to create, so the free form is also limited per network.
    let allowed = true;
    try {
      rateLimit(`form-free:${ip}`, 3, 86_400_000);
    } catch {
      allowed = false;
    }
    if (allowed) {
      insert("form_free_uses", { workspace_id: ctx.workspace.id, month, document_id: documentId, created_at: now() });
      return () => {};
    }
  }
  assertAiCredits(ctx); // throws the usual "get credits" paywall
  return charge;
}

// ---------- shared schema pieces ----------

const PROFILE_KEYS = ["", ...PROFILE_FIELDS.map((f) => f.key), ...Object.keys(DERIVED_KEYS)];
const TYPES: FieldType[] = ["text", "multiline", "date", "number", "email", "phone", "checkbox", "radio", "choice", "signature", "initials"];
const BOX = { type: "array", items: { type: "integer" }, description: "[left, top, right, bottom] in pixels of that page's image" };

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "purpose", "whoFills", "submitTo", "deadline", "tips"],
  properties: {
    title: { type: "string", description: "The form's name, e.g. 'Rental Application' or 'IRS Form W-9'." },
    purpose: { type: "string", description: "One or two plain sentences: what this form is for." },
    whoFills: { type: "string", description: "Who should fill it in, or empty." },
    submitTo: { type: "string", description: "Where or to whom it is returned, if the form says. Else empty." },
    deadline: { type: "string", description: "Any deadline stated on the form. Else empty." },
    tips: { type: "array", items: { type: "string" }, description: "Up to 3 short, practical tips (documents to have ready, common mistakes)." },
  },
};

const COMMON_RULES = `Field rules:
- label: the question as printed on the form, cleaned up (e.g. "Applicant's date of birth").
- section: the heading of the part of the form it belongs to, or "".
- help: one plain-English sentence saying what to write and in what format, with an example when useful. Explain jargon. Never just repeat the label.
- profileKey: the profile entry that answers this field, only when the field asks for that information about the person completing the form (the applicant, employee, patient, taxpayer…). Use "" for anything about other people (co-applicant, spouse, references, landlord) unless the key is clearly theirs, and "" when nothing fits. "full_name" for a single name field, "full_address" for a single address field, "city_state_zip" for a combined line, "today" for the date next to a signature, "signature"/"initials" for signature and initials areas.
- sensitive: true for Social Security / tax ID numbers, passport and license numbers, bank or card numbers, and medical details.
- required: true when the form marks it as required (asterisk, "required") or it is plainly essential (name, signature).
- format: for dates, the layout the form expects, e.g. "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YY". "MM/DD/YYYY" when it doesn't say. "" for other types.`;

// ---------- detection on flat / scanned forms ----------

export type DetectPage = {
  page: number;
  image: string; // base64 JPEG
  width: number;
  height: number;
  /** pdf.js viewport transform for the image: PDF user space → image pixels. */
  transform: [number, number, number, number, number, number];
  candidates: { id: string; kind: "line" | "box" | "square" | "underscore"; box: [number, number, number, number] }[];
};

type DetectedField = {
  page: number;
  candidate: string;
  box: number[];
  type: FieldType;
  label: string;
  section: string;
  help: string;
  profileKey: string;
  sensitive: boolean;
  required: boolean;
  format: string;
  maxLength: number;
  comb: boolean;
  options: { label: string; box: number[] }[];
};

const DETECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "fields"],
  properties: {
    summary: SUMMARY_SCHEMA,
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "candidate", "box", "type", "label", "section", "help", "profileKey", "sensitive", "required", "format", "maxLength", "comb", "options"],
        properties: {
          page: { type: "integer" },
          candidate: { type: "string", description: "Id of the detected candidate area this field uses, or \"\"." },
          box: BOX,
          type: { type: "string", enum: TYPES },
          label: { type: "string" },
          section: { type: "string" },
          help: { type: "string" },
          profileKey: { type: "string", enum: PROFILE_KEYS },
          sensitive: { type: "boolean" },
          required: { type: "boolean" },
          format: { type: "string" },
          maxLength: { type: "integer", description: "Number of character boxes for comb fields, else 0." },
          comb: { type: "boolean" },
          options: {
            type: "array",
            description: "For radio: one entry per choice with the box of its tick area. Else [].",
            items: { type: "object", additionalProperties: false, required: ["label", "box"], properties: { label: { type: "string" }, box: BOX } },
          },
        },
      },
    },
  },
};

const DETECT_SYSTEM = `You find every place on a form where a person is expected to write, tick, choose or sign, so software can fill it in.
You receive page images. Coordinates are pixels in that page's image, origin at the top-left, as [left, top, right, bottom].
For each page you also get candidate areas found in the PDF's drawing: underlines, boxes, small squares (tick boxes) and runs of underscores. When a field's writing area matches a candidate, set "candidate" to its id and copy its box. Otherwise give a box that tightly covers the empty writing area (never the printed label), about one line of text tall for single-line fields.
Include: blanks after labels, boxes and underlines, table cells meant to be filled, tick boxes, signature and date lines, initials boxes.
Exclude: text that is already printed or filled in, decorative lines, "for office use only" areas, and instructions.
A row of separate character boxes for one answer (e.g. SSN digits) is one field with comb=true and maxLength = number of boxes, box spanning all of them.
Mutually exclusive tick boxes ("Yes / No", "Single / Married") are one radio field: box = the whole group, options = each choice with the box of its tick area. Independent tick boxes ("check all that apply") are separate checkbox fields.
Return fields in reading order.
${COMMON_RULES}`;

export async function detectFields(pages: DetectPage[], onUsage: UsageHook): Promise<{ fields: FormField[]; summary: FormSummary | null }> {
  // A few pages per request, in parallel: faster, and each answer stays well within limits.
  const chunks: DetectPage[][] = [];
  for (let i = 0; i < pages.length; i += 3) chunks.push(pages.slice(i, i + 3));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const content: AiContent[] = [];
      for (const p of chunk) {
        content.push({ type: "text", text: `Page ${p.page} (image ${p.width}×${p.height}px):` }, jpegBlock(p.image));
        const cand = p.candidates
          .slice(0, 400)
          .map((c) => `${c.id}: ${c.kind} [${c.box.map(Math.round).join(",")}]`)
          .join("\n");
        content.push({ type: "text", text: `Candidate areas on page ${p.page}:\n${cand || "(none found: this may be a scan; locate the areas from the image)"}` });
      }
      content.push({ type: "text", text: "Return the summary of the form and every fillable field on these pages." });
      return structured<{ summary: FormSummary; fields: DetectedField[] }>({ system: DETECT_SYSTEM, content, schema: DETECT_SCHEMA, effort: "medium", onUsage });
    }),
  );

  const fields: FormField[] = [];
  let n = 0;
  for (const [ci, r] of results.entries()) {
    for (const d of r.fields) {
      const page = chunks[ci].find((p) => p.page === d.page) ?? chunks[ci][0];
      const cand = d.candidate ? page.candidates.find((c) => c.id === d.candidate) : undefined;
      const box = cand?.box ?? (d.box.length === 4 ? (d.box as [number, number, number, number]) : null);
      if (!box) continue;
      const rect = toPdfRect(box, page.transform);
      if (rect[2] < 3 || rect[3] < 3) continue;
      const field: FormField = {
        id: `d${++n}`,
        page: page.page,
        rect,
        type: d.type,
        label: d.label || "Field",
        section: d.section || undefined,
        help: d.help || undefined,
        profileKey: d.profileKey || null,
        sensitive: d.sensitive || looksSensitive(d.label) || undefined,
        required: d.required || undefined,
        format: d.type === "date" ? d.format || "MM/DD/YYYY" : undefined,
        maxLength: d.maxLength > 0 ? d.maxLength : undefined,
        comb: d.comb && d.maxLength > 0 ? true : undefined,
      };
      if (d.type === "radio" && d.options.length) {
        field.options = d.options
          .filter((o) => o.box.length === 4)
          .map((o) => ({ value: o.label, label: o.label, page: page.page, rect: toPdfRect(o.box as [number, number, number, number], page.transform) }));
      }
      fields.push(field);
    }
  }
  return { fields, summary: results[0]?.summary ?? null };
}

/** Image pixels → PDF user-space rectangle, inverting the page's viewport transform. */
export function toPdfRect(box: [number, number, number, number], t: [number, number, number, number, number, number]): Rect {
  const [a, b, c, d, e, f] = t;
  const det = a * d - b * c || 1;
  const pt = (px: number, py: number) => [(d * (px - e) - c * (py - f)) / det, (-b * (px - e) + a * (py - f)) / det];
  const pts = [pt(box[0], box[1]), pt(box[2], box[1]), pt(box[0], box[3]), pt(box[2], box[3])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [round(x), round(y), round(Math.max(...xs) - x), round(Math.max(...ys) - y)];
}

const round = (v: number) => Math.round(v * 100) / 100;

// ---------- labelling a fillable PDF's own fields ----------

export type LabelPage = { page: number; image: string; width: number; height: number; transform: DetectPage["transform"] };

type LabelledField = { id: string; label: string; section: string; help: string; profileKey: string; sensitive: boolean; required: boolean; type: FieldType; format: string };

const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "fields"],
  properties: {
    summary: SUMMARY_SCHEMA,
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "section", "help", "profileKey", "sensitive", "required", "type", "format"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          section: { type: "string" },
          help: { type: "string" },
          profileKey: { type: "string", enum: PROFILE_KEYS },
          sensitive: { type: "boolean" },
          required: { type: "boolean" },
          type: { type: "string", enum: TYPES, description: "Keep the given type, except a text field that really holds a date, email, phone, number or several lines." },
          format: { type: "string" },
        },
      },
    },
  },
};

const LABEL_SYSTEM = `A PDF form already has fillable fields, but their internal names are often cryptic (e.g. "f1_04[0]"). Using the page images and each field's position, work out what each field asks for, as a person reading the printed form would.
Coordinates are pixels in that page's image, origin top-left, as [left, top, right, bottom]. Return every field id you were given, exactly once.
${COMMON_RULES}`;

export async function labelFields(fields: FormField[], pages: LabelPage[], onUsage: UsageHook): Promise<{ fields: FormField[]; summary: FormSummary | null }> {
  const byPage = new Map<number, FormField[]>();
  for (const f of fields) byPage.set(f.page, [...(byPage.get(f.page) ?? []), f]);
  const pageNums = [...byPage.keys()].sort((a, b) => a - b);
  // Pages with many fields go alone; small ones are grouped, up to ~120 fields a request.
  const chunks: number[][] = [];
  let cur: number[] = [];
  let count = 0;
  for (const p of pageNums) {
    const c = byPage.get(p)!.length;
    if (cur.length && (count + c > 120 || cur.length >= 3)) {
      chunks.push(cur);
      cur = [];
      count = 0;
    }
    cur.push(p);
    count += c;
  }
  if (cur.length) chunks.push(cur);

  const results = await Promise.all(
    chunks.map((nums) => {
      const content: AiContent[] = [];
      for (const num of nums) {
        const page = pages.find((p) => p.page === num);
        const list = byPage.get(num)!;
        if (page) content.push({ type: "text", text: `Page ${num} (image ${page.width}×${page.height}px):` }, jpegBlock(page.image));
        const lines = list.map((f) => {
          const box = page ? toPixelBox(f.rect, page.transform).join(",") : "";
          const opts = f.options?.length ? ` options: ${f.options.map((o) => o.label).join(" | ")}` : "";
          return `${f.id} | ${f.type} | name "${f.acro ?? ""}" | tooltip "${f.label}" | [${box}]${f.maxLength ? ` | max ${f.maxLength} chars` : ""}${opts}`;
        });
        content.push({ type: "text", text: `Fields on page ${num}:\n${lines.join("\n")}` });
      }
      content.push({ type: "text", text: "Return the summary of the form and every field above with its label and details." });
      return structured<{ summary: FormSummary; fields: LabelledField[] }>({ system: LABEL_SYSTEM, content, schema: LABEL_SCHEMA, effort: "low", onUsage });
    }),
  );

  const info = new Map<string, LabelledField>();
  for (const r of results) for (const f of r.fields) info.set(f.id, f);
  const out = fields.map((f) => {
    const l = info.get(f.id);
    if (!l) return f;
    const keepType = ["checkbox", "radio", "choice", "signature"].includes(f.type);
    const type = keepType ? f.type : l.type;
    return {
      ...f,
      label: l.label || f.label,
      section: l.section || undefined,
      help: l.help || undefined,
      profileKey: l.profileKey || null,
      sensitive: l.sensitive || f.sensitive || undefined,
      required: l.required || f.required || undefined,
      type,
      format: type === "date" ? l.format || "MM/DD/YYYY" : undefined,
    } satisfies FormField;
  });
  return { fields: out, summary: results[0]?.summary ?? null };
}

function toPixelBox(rect: Rect, t: DetectPage["transform"]): number[] {
  const [a, b, c, d, e, f] = t;
  const pt = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
  const [x, y, w, h] = rect;
  const pts = [pt(x, y), pt(x + w, y), pt(x, y + h), pt(x + w, y + h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
}

// ---------- smart fill ----------

export type FillSource = { title: string; text: string };
export type FillResult = { values: FormValues; questions: string[] };

const FILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["values", "questions"],
  properties: {
    values: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "value", "source", "confidence", "note"],
        properties: {
          id: { type: "string" },
          value: { type: "string" },
          source: { type: "string", enum: ["profile", "document", "ai"] },
          confidence: { type: "number", description: "0 to 1: how sure you are this is right." },
          note: { type: "string", description: "Short reason when it's an inference or a judgment call, else \"\"." },
        },
      },
    },
    questions: { type: "array", items: { type: "string" }, description: "Up to 5 short questions for the person about information you need but don't have." },
  },
};

const FILL_SYSTEM = `You fill in a form for a person, using only what they've given you: their saved profile, their instructions, and their supporting documents.
Rules:
- Only fill a field when the answer is supported by that information or follows directly from it (e.g. full name from first and last name, age from date of birth, "N/A" only where the form asks for it). Leave it out otherwise; never invent facts, numbers or identifiers.
- source: "profile" (from the profile), "document" (read from a supporting document), "ai" (inferred, or from the instructions).
- Dates in the field's format. Checkboxes: "true" or "false". Radio and choice fields: exactly one of the listed options. Respect max lengths.
- Fields about other people (spouse, references, co-applicant) only from the instructions or documents, never from the person's own profile.
- Leave out signature and initials fields, and any field marked as already answered by the person.
- Ask at most 5 questions, only for information that would complete required or important fields.`;

export async function smartFill(opts: {
  fields: FormField[];
  profile: ProfileData | null;
  current: FormValues;
  instructions: string;
  sources: FillSource[];
  summary: FormSummary | null;
  onUsage: UsageHook;
}): Promise<FillResult> {
  const todo = opts.fields.filter((f) => f.type !== "signature" && f.type !== "initials" && !f.readOnly);
  const describe = (f: FormField) => {
    const parts = [`${f.id} | ${f.type} | "${f.label}"`];
    if (f.section) parts.push(`section "${f.section}"`);
    if (f.help) parts.push(`help: ${f.help}`);
    if (f.format) parts.push(`format ${f.format}`);
    if (f.maxLength) parts.push(`max ${f.maxLength} chars`);
    if (f.options?.length) parts.push(`options: ${f.options.map((o) => o.value).join(" | ")}`);
    const cur = opts.current[f.id];
    if (cur?.source === "you" && cur.value) parts.push("ANSWERED BY THE PERSON (skip)");
    return parts.join(" | ");
  };
  const profileText = opts.profile
    ? [
        ...Object.entries(opts.profile.values)
          .filter(([, v]) => v?.trim())
          .map(([k, v]) => `${PROFILE_FIELDS.find((p) => p.key === k)?.label ?? k}: ${v}`),
        ...opts.profile.custom.filter((c) => c.value.trim()).map((c) => `${c.label}: ${c.value}`),
      ].join("\n")
    : "";
  const content: AiContent[] = [
    ...opts.sources.map(
      (s) =>
        ({
          type: "document",
          source: { type: "text", media_type: "text/plain", data: s.text.slice(0, 60_000) || "(no text)" },
          title: s.title,
        }) as AiContent,
    ),
    {
      type: "text",
      text: [
        `Today is ${new Date().toISOString().slice(0, 10)}.`,
        opts.summary ? `The form: ${opts.summary.title}. ${opts.summary.purpose}` : "",
        `Profile of the person filling the form:\n${profileText || "(empty)"}`,
        opts.instructions.trim() ? `Their instructions:\n${opts.instructions.trim()}` : "",
        opts.sources.length ? `Supporting documents are attached above.` : "",
        `Fields:\n${todo.map(describe).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const r = await structured<{ values: { id: string; value: string; source: "profile" | "document" | "ai"; confidence: number; note: string }[]; questions: string[] }>({
    system: FILL_SYSTEM,
    content,
    schema: FILL_SCHEMA,
    effort: "medium",
    onUsage: opts.onUsage,
  });
  const ids = new Set(todo.map((f) => f.id));
  const values: FormValues = {};
  for (const v of r.values) {
    if (!ids.has(v.id) || !v.value.trim()) continue;
    if (opts.current[v.id]?.source === "you" && opts.current[v.id].value) continue;
    values[v.id] = { value: v.value, source: v.source, confidence: Math.max(0, Math.min(1, v.confidence)), note: v.note || undefined };
  }
  return { values, questions: r.questions.slice(0, 5) };
}

export function assertPages(pages: unknown[]) {
  if (!pages.length) throw new HttpError(400, "No pages to read.");
  if (pages.length > 30) throw new HttpError(400, "Forms up to 30 pages are supported. Split the PDF and fill each part.");
}
