import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./http";

export const AI_MODEL = process.env.PDFTEK_AI_MODEL || "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_PDF_BYTES = 30 * 1024 * 1024;

let client: Anthropic | null = null;

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function ai(): Anthropic {
  if (!aiConfigured()) {
    throw new HttpError(503, "AI features need an Anthropic API key. Set ANTHROPIC_API_KEY on the server.", "ai_not_configured");
  }
  client ??= new Anthropic();
  return client;
}

export function describeAiError(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Anthropic.RateLimitError) return "The AI service is busy right now. Try again in a moment.";
  if (err instanceof Anthropic.AuthenticationError) return "The server's Anthropic API key was rejected.";
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status ?? "network"}). Try again.`;
  return "The AI request failed. Try again.";
}

// ---------- sources ----------

export type Source =
  | { kind: "pdf"; title: string; pdf: Buffer; fallbackText: string }
  | { kind: "text"; title: string; text: string };

export type SourceRef = { documentId: string; documentName: string; page?: number };

function toBlock(src: Source, cache: boolean): Anthropic.Beta.BetaContentBlockParam {
  const cache_control = cache ? { type: "ephemeral" as const } : undefined;
  if (src.kind === "pdf" && src.pdf.length <= MAX_PDF_BYTES) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: src.pdf.toString("base64") },
      title: src.title,
      citations: { enabled: true },
      cache_control,
    };
  }
  const text = src.kind === "pdf" ? src.fallbackText : src.text;
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: text || "(no text)" },
    title: src.title,
    citations: { enabled: true },
    cache_control,
  };
}

// ---------- chat with citations ----------

export type Citation = {
  documentIndex: number;
  documentTitle: string | null;
  citedText: string;
  startPage?: number;
  endPage?: number;
};

export type Segment = { text: string; citations: Citation[] };

export type ChatEvent =
  | { type: "segment" }
  | { type: "text"; text: string }
  | { type: "citation"; citation: Citation }
  | { type: "refusal"; message: string };

const CHAT_SYSTEM = `You are pdftek's document assistant, working for professional teams (legal, finance, research, operations).
Answer strictly from the provided documents. Quote exact figures, dates, parties, and section numbers. When the documents don't answer the question, say so plainly and suggest what to look for.
Be direct and concise: lead with the answer in one or two sentences, then supporting detail as short bullets only if needed. No preamble. Use plain text with minimal markdown (bold and bullets only).
You are not a lawyer or financial adviser; when a question calls for professional judgment, give the document-grounded facts and flag the judgment call briefly.`;

export async function* streamChat(opts: {
  sources: Source[];
  history: { role: "user" | "assistant"; content: string }[];
  question: string;
  extraSystem?: string;
}): AsyncGenerator<ChatEvent, { segments: Segment[] }> {
  const docBlocks = opts.sources.map((s, i) => toBlock(s, i === opts.sources.length - 1));
  const turns = [...opts.history.slice(-12), { role: "user" as const, content: opts.question }];
  while (turns.length && turns[0].role !== "user") turns.shift();
  // Documents sit at the very start of the first turn so the prefix stays cacheable across turns.
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t, i) =>
    i === 0 ? { role: "user", content: [...docBlocks, { type: "text", text: t.content }] } : { role: t.role, content: t.content },
  );
  const stream = ai().beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: CHAT_SYSTEM + (opts.extraSystem ? `\n\n${opts.extraSystem}` : ""),
    messages,
  });

  const segments: Segment[] = [];
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "text") {
      segments.push({ text: "", citations: [] });
      yield { type: "segment" };
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        if (!segments.length) segments.push({ text: "", citations: [] });
        segments[segments.length - 1].text += event.delta.text;
        yield { type: "text", text: event.delta.text };
      } else if (event.delta.type === "citations_delta") {
        const c = event.delta.citation;
        if (!("document_index" in c)) continue;
        const citation: Citation = {
          documentIndex: c.document_index,
          documentTitle: c.document_title,
          citedText: c.cited_text,
          ...(c.type === "page_location" ? { startPage: c.start_page_number, endPage: c.end_page_number } : {}),
        };
        if (!segments.length) segments.push({ text: "", citations: [] });
        segments[segments.length - 1].citations.push(citation);
        yield { type: "citation", citation };
      }
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    const message = "The assistant declined to answer this request.";
    segments.push({ text: message, citations: [] });
    yield { type: "refusal", message };
  }
  return { segments };
}

// ---------- structured extraction ----------

export type ExtractionTable = { title: string; columns: string[]; rows: string[][] };
export type ExtractionResult = { summary: string; tables: ExtractionTable[] };

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tables"],
  properties: {
    summary: { type: "string", description: "Two to four sentence overview of what was found." },
    tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "columns", "rows"],
        properties: {
          title: { type: "string" },
          columns: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "array", items: { type: "string" } } },
        },
      },
    },
  },
} as const;

export const EXTRACT_PRESETS: Record<string, { title: string; instruction: string }> = {
  key_terms: {
    title: "Key terms",
    instruction:
      'One table titled "Key terms" with columns ["Term", "Value", "Page"]. Cover parties, effective date, term, renewal, termination rights, notice periods, payment terms, fees, liability cap, governing law, and any other commercially important term. Use the exact wording for values; keep each value under 40 words.',
  },
  dates: {
    title: "Dates & deadlines",
    instruction:
      'One table titled "Dates & deadlines" with columns ["Event", "Date or timing", "Notice / action required", "Page"]. Include effective dates, expiry, renewal windows, notice deadlines, payment dates, reporting deadlines. Where a date is relative (e.g. "60 days before expiry"), compute the absolute date if the anchor date is known and show both.',
  },
  parties: {
    title: "Parties & signatories",
    instruction: 'One table titled "Parties" with columns ["Party", "Role", "Address / identifiers", "Signatory", "Page"].',
  },
  obligations: {
    title: "Obligations",
    instruction:
      'One table titled "Obligations" with columns ["Party", "Obligation", "Timing / condition", "Page"]. Only binding obligations ("shall", "must", "agrees to").',
  },
  risks: {
    title: "Risk flags",
    instruction:
      'One table titled "Risk flags" with columns ["Severity", "Issue", "Clause", "Why it matters", "Suggested position", "Page"]. Severity is High, Medium, or Low. Review against the team playbook provided below; deviations from the playbook are findings. Order by severity.',
  },
  financials: {
    title: "Financial figures",
    instruction:
      'One table titled "Financial figures" with columns ["Item", "Amount", "Currency", "Frequency / period", "Page"]. Include fees, prices, caps, penalties, totals, and any financial statement line items.',
  },
  tables: {
    title: "Tables",
    instruction:
      "Reproduce every data table in the document as its own table (title = the table's caption or a short description + page number). Preserve column headers and cell values exactly.",
  },
};

export async function extract(opts: {
  source: Source;
  preset: string;
  customFields?: string[];
  playbook?: string;
}): Promise<ExtractionResult> {
  let instruction: string;
  if (opts.preset === "custom") {
    const fields = (opts.customFields ?? []).filter(Boolean).slice(0, 30);
    instruction = `One table titled "Extracted fields" with columns ["Field", "Value", "Page"], one row per requested field in this order: ${fields
      .map((f) => JSON.stringify(f))
      .join(", ")}. Use "Not found" when the document doesn't contain it.`;
  } else {
    const preset = EXTRACT_PRESETS[opts.preset];
    if (!preset) throw new HttpError(400, "Unknown extraction type.");
    instruction = preset.instruction;
  }
  const playbook = opts.preset === "risks" && opts.playbook ? `\n\nTeam playbook:\n${opts.playbook}` : "";
  const stream = ai().beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 32000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    system:
      "You extract structured data from business documents with exact fidelity. Never invent values. Page numbers refer to the PDF page where the information appears. Cells are plain strings.",
    messages: [
      {
        role: "user",
        content: [
          { ...toBlock(opts.source, false), citations: undefined } as Anthropic.Beta.BetaContentBlockParam,
          { type: "text", text: `${instruction}${playbook}` },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new HttpError(422, "The assistant declined to process this document.");
  if (msg.stop_reason === "max_tokens") throw new HttpError(422, "The document is too large to extract in one pass. Try a narrower extraction.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text) as ExtractionResult;
  } catch {
    throw new HttpError(502, "The AI returned an unreadable result. Try again.");
  }
}

// ---------- plain completions (summaries, compare insights, automations) ----------

export async function complete(opts: { system: string; sources?: Source[]; prompt: string; effort?: "low" | "medium" | "high" }) {
  const stream = ai().beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: opts.effort ?? "medium" },
    system: opts.system,
    messages: [
      {
        role: "user",
        content: [
          ...(opts.sources ?? []).map((s) => ({ ...toBlock(s, false), citations: undefined }) as Anthropic.Beta.BetaContentBlockParam),
          { type: "text", text: opts.prompt },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new HttpError(422, "The assistant declined this request.");
  return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
}
