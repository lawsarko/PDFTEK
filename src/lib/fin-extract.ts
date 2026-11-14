import "server-only";
import path from "node:path";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { get, insert, run } from "./db";
import { now } from "./ids";
import { HttpError } from "./http";
import { rateLimit, type Ctx } from "./auth";
import { chargeAi, entitlements, tierOf, workspaceCanUseAi, AI_MIN_CREDITS } from "./billing";
import { jpegBlock, structured, type AiContent, type UsageHook } from "./ai";
import type { DocumentRow } from "./documents";

/**
 * Bank statements and invoices → structured rows.
 *
 * Each page is sent to the AI as a column-preserving text picture of the page (so it can tell the
 * "money out" column from "money in"), or as an image when the page is a scan. Long statements are
 * read a few pages at a time, in parallel. The results are then checked the way a bookkeeper would:
 * running balances must add up, the opening balance plus every transaction must equal the closing
 * balance, and invoice lines must add up to the total. Rows that don't add up are flagged.
 */

export type FinKind = "statement" | "invoice";

export type Txn = {
  date: string; // YYYY-MM-DD, or "" when the statement doesn't show one
  description: string;
  amount: number; // money in is positive, money out negative
  balance: number | null;
  page: number;
  /** Set when this row's running balance doesn't follow from the previous one. */
  flag?: string;
};

export type StatementResult = {
  kind: "statement";
  bank: string;
  accountHolder: string;
  accountNumber: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: Txn[];
  pages: number;
  check: { reconciled: boolean | null; difference: number | null; balanceBreaks: number; signFixes: number; moneyIn: number; moneyOut: number };
};

export type InvoiceLine = { description: string; quantity: number | null; unitPrice: number | null; amount: number | null };
export type Invoice = {
  vendor: string;
  vendorAddress: string;
  vendorTaxId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  poNumber: string;
  billTo: string;
  currency: string;
  subtotal: number | null;
  tax: number | null;
  shipping: number | null;
  discount: number | null;
  total: number | null;
  amountDue: number | null;
  paymentTerms: string;
  lines: InvoiceLine[];
  page: number;
  check: { ok: boolean | null; note: string };
};
export type InvoiceResult = { kind: "invoice"; invoices: Invoice[]; pages: number };
export type FinResult = StatementResult | InvoiceResult;

/** Longest document accepted in one go. */
export const MAX_FIN_PAGES = 60;
/** The free document each month can be at most this long. */
export const FREE_FIN_PAGES = 10;
/** Rough cost per page, used to stop a read that the balance can't cover. */
export const CREDITS_PER_PAGE = 6;

// ---------- billing ----------

/**
 * Who pays for a read. Each workspace gets one document a month free (up to FREE_FIN_PAGES pages);
 * beyond that it's AI credits at the real cost.
 */
export function finAi(ctx: Ctx, doc: DocumentRow, ip: string): UsageHook {
  const month = new Date().toISOString().slice(0, 7);
  const charge: UsageHook = (model, usage) => chargeAi(ctx, model, usage, "Statements & invoices to Excel");
  if (tierOf(ctx) === "admin") return charge;
  const free = get<{ document_id: string }>("SELECT document_id FROM fin_free_uses WHERE workspace_id = ? AND month = ?", ctx.workspace.id, month);
  if (free?.document_id === doc.id) return () => {};
  const e = entitlements(ctx);
  const balance = e.credits + e.allowance;
  const estimate = doc.page_count * CREDITS_PER_PAGE;
  // The free document comes first, so nobody pays for their first statement.
  if (!free && doc.page_count <= FREE_FIN_PAGES) {
    // Guest sessions are cheap to create, so the free document is also limited per network.
    let allowed = true;
    try {
      rateLimit(`fin-free:${ip}`, 2, 86_400_000);
    } catch {
      allowed = false;
    }
    if (allowed) {
      insert("fin_free_uses", { workspace_id: ctx.workspace.id, month, document_id: doc.id, created_at: now() });
      return () => {};
    }
  }
  if (balance >= Math.max(AI_MIN_CREDITS, Math.min(estimate, 120)) && workspaceCanUseAi(ctx.workspace.id)) return charge;
  const why = !free && doc.page_count > FREE_FIN_PAGES ? `The free monthly document can be up to ${FREE_FIN_PAGES} pages; this one has ${doc.page_count}. ` : free ? "You've used this month's free document. " : "";
  throw new HttpError(
    402,
    `${why}Reading statements and invoices uses AI credits: about ${CREDITS_PER_PAGE} per page, so this one needs about ${estimate}. Get 250 credits for $2.99, a Day Pass ($1.99, includes 50) or Pro (400 a month).`,
    "credits_required",
  );
}

// ---------- cache ----------

export function cachedResult(doc: DocumentRow, kind: FinKind): FinResult | null {
  const row = get<{ result_json: string }>("SELECT result_json FROM fin_extractions WHERE document_id = ? AND version_id = ? AND kind = ?", doc.id, doc.current_version_id, kind);
  return row ? (JSON.parse(row.result_json) as FinResult) : null;
}

export function saveResult(doc: DocumentRow, kind: FinKind, result: FinResult) {
  run(
    "INSERT INTO fin_extractions (document_id, version_id, kind, result_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(document_id, version_id, kind) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at",
    doc.id,
    doc.current_version_id,
    kind,
    JSON.stringify(result),
    now(),
  );
}

// ---------- reading the pages ----------

type PagePart = { page: number; text?: string; image?: string };

const GRID = 150; // characters across the page

/** Each page as text laid out on a character grid (columns stay lined up), or a JPEG for scans. */
async function readPages(bytes: Uint8Array): Promise<PagePart[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = (await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
    verbosity: 0,
  }).promise) as unknown as PDFDocumentProxy;
  try {
    if (doc.numPages > MAX_FIN_PAGES) throw new HttpError(413, `This PDF has ${doc.numPages} pages. Statements and invoices can be up to ${MAX_FIN_PAGES} pages; split it first.`);
    const out: PagePart[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: { x: number; y: number; w: number; str: string }[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]) as [number, number];
        items.push({ x, y, w: it.width, str: it.str });
      }
      const chars = items.reduce((n, i) => n + i.str.trim().length, 0);
      if (chars < 40) {
        out.push({ page: p, image: await renderJpeg(doc, p) });
      } else {
        out.push({ page: p, text: gridText(items, vp.width) });
      }
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

function gridText(items: { x: number; y: number; w: number; str: string }[], width: number): string {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: (typeof items)[] = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - it.y) < 3) last.push(it);
    else rows.push([it]);
  }
  const scale = GRID / width;
  return rows
    .map((r) => {
      let line = "";
      for (const it of r.sort((a, b) => a.x - b.x)) {
        const col = Math.round(it.x * scale);
        if (line.length < col) line += " ".repeat(col - line.length);
        else if (line && !line.endsWith(" ")) line += " ";
        line += it.str.replace(/\s+/g, " ");
      }
      return line.trimEnd();
    })
    .join("\n");
}

async function renderJpeg(doc: PDFDocumentProxy, p: number): Promise<string> {
  const page = await doc.getPage(p);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, 1800 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  type Canvas = { width: number; height: number; toBuffer(mime: string, quality?: number): Buffer };
  type C2D = { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
  const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: Canvas; context: C2D } } }).canvasFactory;
  const { canvas, context } = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
  return canvas.toBuffer("image/jpeg", 80).toString("base64");
}

function pageBlocks(parts: PagePart[]): AiContent[] {
  const blocks: AiContent[] = [];
  for (const p of parts) {
    if (p.image) {
      blocks.push({ type: "text", text: `--- Page ${p.page} (scanned image) ---` });
      blocks.push(jpegBlock(p.image));
    } else blocks.push({ type: "text", text: `--- Page ${p.page} ---\n${p.text}` });
  }
  return blocks;
}

/** Runs `jobs` with at most `limit` in flight, keeping their order. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /-\s*$/.test(t) || /^-/.test(t) || /\bDR\b/i.test(t);
  t = t.replace(/[^0-9.,]/g, "");
  // "1.234,56" (European) vs "1,234.56"
  if (/,\d{1,2}$/.test(t) && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/,\d{1,2}$/.test(t) && !t.includes(".")) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || t === "") return null;
  return Math.round((negative ? -n : n) * 100) / 100;
};
const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : "");

// ---------- bank statements ----------

const STATEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bank", "accountHolder", "accountNumber", "currency", "periodStart", "periodEnd", "openingBalance", "closingBalance", "transactions"],
  properties: {
    bank: { type: "string", description: "Bank or card issuer name, or \"\" if not on these pages." },
    accountHolder: { type: "string" },
    accountNumber: { type: "string", description: "As printed (often partly masked)." },
    currency: { type: "string", description: "ISO code such as USD, GBP, EUR, or \"\"." },
    periodStart: { type: "string", description: "YYYY-MM-DD or \"\"." },
    periodEnd: { type: "string", description: "YYYY-MM-DD or \"\"." },
    openingBalance: { type: "string", description: "Opening / previous / beginning balance as a plain number (negative if overdrawn), or \"\" if not on these pages." },
    closingBalance: { type: "string", description: "Closing / ending / new balance as a plain number, or \"\" if not on these pages." },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "description", "amount", "balance", "page"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD. Infer the year from the statement period." },
          description: { type: "string", description: "The full description, including continuation lines, reference numbers and payee." },
          amount: { type: "string", description: "Signed plain number: money INTO the account positive, money OUT negative. E.g. \"-45.10\", \"1200.00\"." },
          balance: { type: "string", description: "Running balance shown on that row as a plain number, or \"\"." },
          page: { type: "integer" },
        },
      },
    },
  },
};

type RawStatement = {
  bank: string;
  accountHolder: string;
  accountNumber: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  transactions: { date: string; description: string; amount: string; balance: string; page: number }[];
};

const STATEMENT_SYSTEM = `You transcribe bank, credit card and savings account statements into structured rows with exact fidelity. Accountants import your output, so every digit matters.

Rules:
- One entry per transaction line, in the order printed. Include every transaction on the pages you are given, including fees, interest, cheques and transfers. Never invent or merge transactions, and never skip one.
- Do NOT list balance lines ("Opening balance", "Balance brought forward", "Closing balance", daily balance summaries) or section totals as transactions; report opening/closing balances in their own fields.
- Sign: money coming in (deposits, credits, refunds, interest earned) is positive; money going out (withdrawals, debits, card purchases, payments, fees, cheques) is negative. Use the column the amount sits in ("Withdrawals"/"Debits"/"Paid out" vs "Deposits"/"Credits"/"Paid in"), signs, "DR"/"CR" markers and the running balance to decide. On a credit card statement, purchases and fees are negative and payments to the card are positive.
- Dates: output YYYY-MM-DD. When rows show only day and month, take the year from the statement period (watch for periods that cross a year end).
- Descriptions: join wrapped continuation lines into one description. Keep reference numbers.
- Amounts are plain numbers with a dot for decimals and no currency symbols or thousands separators.
- The page texts preserve the page layout: columns line up vertically, so use horizontal position to tell which column an amount belongs to.`;

export async function readStatement(bytes: Uint8Array, onUsage: UsageHook): Promise<StatementResult> {
  const parts = await readPages(bytes);
  const PER_CALL = 3;
  const chunks: PagePart[][] = [];
  for (let i = 0; i < parts.length; i += PER_CALL) chunks.push(parts.slice(i, i + PER_CALL));
  // Later chunks see the top of page 1 for context: column headings, period and year.
  const header = parts[0]?.text ? parts[0].text.split("\n").slice(0, 30).join("\n") : "";
  const raws = await pool(
    chunks.map((chunk, i) => () => {
      const first = chunk[0].page;
      const last = chunk[chunk.length - 1].page;
      const context: AiContent[] =
        i > 0 && header ? [{ type: "text", text: `Context only, from the top of page 1 (do not extract transactions from it):\n${header}` }] : [];
      return structured<RawStatement>({
        system: STATEMENT_SYSTEM,
        content: [
          ...context,
          ...pageBlocks(chunk),
          { type: "text", text: `These are pages ${first}–${last} of a ${parts.length}-page statement. Extract the statement details shown on these pages and every transaction on them.` },
        ],
        schema: STATEMENT_SCHEMA,
        effort: "medium",
        maxTokens: 48000,
        onUsage,
        tooLong: `Pages ${first}–${last} have more transactions than can be read at once. Split the PDF into smaller parts and try again.`,
      });
    }),
    4,
  );

  const pick = (k: keyof Omit<RawStatement, "transactions">, from: "first" | "last" = "first") => {
    const list = from === "first" ? raws : [...raws].reverse();
    return list.map((r) => (r[k] ?? "").trim()).find(Boolean) ?? "";
  };
  const transactions: Txn[] = [];
  for (const r of raws)
    for (const t of r.transactions) {
      const amount = num(t.amount);
      if (amount === null) continue;
      transactions.push({ date: isoDate(t.date), description: t.description.replace(/\s+/g, " ").trim(), amount, balance: num(t.balance), page: t.page });
    }
  const result: StatementResult = {
    kind: "statement",
    bank: pick("bank"),
    accountHolder: pick("accountHolder"),
    accountNumber: pick("accountNumber"),
    currency: pick("currency").toUpperCase().slice(0, 3),
    periodStart: isoDate(pick("periodStart")),
    periodEnd: isoDate(pick("periodEnd", "last")),
    openingBalance: num(pick("openingBalance")),
    closingBalance: num(pick("closingBalance", "last")),
    transactions,
    pages: parts.length,
    check: { reconciled: null, difference: null, balanceBreaks: 0, signFixes: 0, moneyIn: 0, moneyOut: 0 },
  };
  reconcile(result);
  return result;
}

const cents = (n: number) => Math.round(n * 100);

/** Checks running balances (fixing a sign the balance proves wrong) and the overall totals. */
export function reconcile(s: StatementResult) {
  const list = s.transactions;
  // Statements printed newest first are checked oldest first.
  const dated = list.filter((t) => t.date);
  const reversed = dated.length > 1 && dated[0].date > dated[dated.length - 1].date;
  const order = reversed ? [...list].reverse() : list;
  let prev: number | null = s.openingBalance;
  let breaks = 0;
  let fixes = 0;
  for (const t of order) {
    delete t.flag;
    if (t.balance !== null && prev !== null) {
      if (cents(prev + t.amount) !== cents(t.balance)) {
        if (cents(prev - t.amount) === cents(t.balance)) {
          t.amount = -t.amount;
          fixes++;
        } else {
          t.flag = `Balance should be ${(prev + t.amount).toFixed(2)}`;
          breaks++;
        }
      }
    }
    if (t.balance !== null) prev = t.balance;
    else if (prev !== null) prev = prev + t.amount;
  }
  // Fill an opening balance the statement implies but doesn't print.
  if (s.openingBalance === null && order[0]?.balance != null) s.openingBalance = Math.round((order[0].balance - order[0].amount) * 100) / 100;
  if (s.closingBalance === null && order.length && order[order.length - 1].balance != null) s.closingBalance = order[order.length - 1].balance;
  const sum = list.reduce((n, t) => n + t.amount, 0);
  s.check.moneyIn = Math.round(list.filter((t) => t.amount > 0).reduce((n, t) => n + t.amount, 0) * 100) / 100;
  s.check.moneyOut = Math.round(-list.filter((t) => t.amount < 0).reduce((n, t) => n + t.amount, 0) * 100) / 100;
  s.check.balanceBreaks = breaks;
  s.check.signFixes = fixes;
  if (s.openingBalance !== null && s.closingBalance !== null) {
    const diff = Math.round((s.openingBalance + sum - s.closingBalance) * 100) / 100;
    s.check.difference = diff;
    s.check.reconciled = Math.abs(diff) < 0.005;
  }
}

// ---------- invoices & receipts ----------

const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["invoices"],
  properties: {
    invoices: {
      type: "array",
      description: "One entry per separate invoice, bill or receipt in the pages (a PDF may contain several).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["vendor", "vendorAddress", "vendorTaxId", "invoiceNumber", "invoiceDate", "dueDate", "poNumber", "billTo", "currency", "subtotal", "tax", "shipping", "discount", "total", "amountDue", "paymentTerms", "lines", "page"],
        properties: {
          vendor: { type: "string", description: "Seller / supplier / merchant name." },
          vendorAddress: { type: "string" },
          vendorTaxId: { type: "string", description: "VAT / GST / EIN / tax number, or \"\"." },
          invoiceNumber: { type: "string", description: "Invoice, bill or receipt number, or \"\"." },
          invoiceDate: { type: "string", description: "YYYY-MM-DD or \"\"." },
          dueDate: { type: "string", description: "YYYY-MM-DD or \"\"." },
          poNumber: { type: "string" },
          billTo: { type: "string", description: "Customer name (and company) billed, or \"\"." },
          currency: { type: "string", description: "ISO code such as USD, GBP, EUR, or \"\"." },
          subtotal: { type: "string", description: "Plain number or \"\"." },
          tax: { type: "string", description: "Total tax (VAT/GST/sales tax) as a plain number, or \"\"." },
          shipping: { type: "string", description: "Plain number or \"\"." },
          discount: { type: "string", description: "Discount as a positive plain number, or \"\"." },
          total: { type: "string", description: "Invoice total as a plain number." },
          amountDue: { type: "string", description: "Balance / amount due as a plain number, or \"\"." },
          paymentTerms: { type: "string", description: "e.g. \"Net 30\", or \"\"." },
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["description", "quantity", "unitPrice", "amount"],
              properties: {
                description: { type: "string" },
                quantity: { type: "string", description: "Plain number or \"\"." },
                unitPrice: { type: "string", description: "Plain number or \"\"." },
                amount: { type: "string", description: "Line total as a plain number, or \"\"." },
              },
            },
          },
          page: { type: "integer", description: "Page where this invoice starts." },
        },
      },
    },
  },
};

type RawInvoice = Record<Exclude<keyof Invoice, "lines" | "page" | "check">, string> & { lines: { description: string; quantity: string; unitPrice: string; amount: string }[]; page: number };

const INVOICE_SYSTEM = `You transcribe invoices, bills and receipts into structured data with exact fidelity for accounts-payable import.
Rules:
- Never invent values. Use "" when something isn't shown.
- Numbers are plain: dot for decimals, no currency symbols, no thousands separators.
- Dates are YYYY-MM-DD.
- Line items: every billed line in order, with its quantity, unit price and line total as printed. Don't list subtotal, tax, shipping or total rows as line items.
- If the pages hold several separate invoices or receipts, return each one separately.
- The page texts preserve the page layout: columns line up vertically.`;

export async function readInvoices(bytes: Uint8Array, onUsage: UsageHook): Promise<InvoiceResult> {
  const parts = await readPages(bytes);
  const PER_CALL = 8;
  const chunks: PagePart[][] = [];
  for (let i = 0; i < parts.length; i += PER_CALL) chunks.push(parts.slice(i, i + PER_CALL));
  const raws = await pool(
    chunks.map((chunk) => () =>
      structured<{ invoices: RawInvoice[] }>({
        system: INVOICE_SYSTEM,
        content: [...pageBlocks(chunk), { type: "text", text: "Extract every invoice, bill or receipt in these pages." }],
        schema: INVOICE_SCHEMA,
        effort: "medium",
        maxTokens: 32000,
        onUsage,
        tooLong: "These invoices are too long to read at once. Split the PDF into smaller parts and try again.",
      }),
    ),
    4,
  );
  const invoices: Invoice[] = raws.flatMap((r) =>
    r.invoices.map((v) => {
      const inv: Invoice = {
        vendor: v.vendor.trim(),
        vendorAddress: v.vendorAddress.replace(/\s+/g, " ").trim(),
        vendorTaxId: v.vendorTaxId.trim(),
        invoiceNumber: v.invoiceNumber.trim(),
        invoiceDate: isoDate(v.invoiceDate),
        dueDate: isoDate(v.dueDate),
        poNumber: v.poNumber.trim(),
        billTo: v.billTo.replace(/\s+/g, " ").trim(),
        currency: v.currency.trim().toUpperCase().slice(0, 3),
        subtotal: num(v.subtotal),
        tax: num(v.tax),
        shipping: num(v.shipping),
        discount: num(v.discount),
        total: num(v.total),
        amountDue: num(v.amountDue),
        paymentTerms: v.paymentTerms.trim(),
        lines: v.lines.map((l) => ({ description: l.description.replace(/\s+/g, " ").trim(), quantity: num(l.quantity), unitPrice: num(l.unitPrice), amount: num(l.amount) })),
        page: v.page,
        check: { ok: null, note: "" },
      };
      checkInvoice(inv);
      return inv;
    }),
  );
  return { kind: "invoice", invoices, pages: parts.length };
}

/** Lines should add up to the subtotal, and subtotal + tax + shipping − discount to the total. */
export function checkInvoice(v: Invoice) {
  const notes: string[] = [];
  let ok: boolean | null = null;
  const lineSum = v.lines.reduce((n, l) => n + (l.amount ?? 0), 0);
  if (v.lines.length && v.lines.every((l) => l.amount !== null) && v.subtotal !== null) {
    const good = cents(lineSum) === cents(v.subtotal);
    ok = good;
    if (!good) notes.push(`Lines add up to ${lineSum.toFixed(2)}, subtotal is ${v.subtotal.toFixed(2)}`);
  }
  if (v.subtotal !== null && v.total !== null) {
    const expected = v.subtotal + (v.tax ?? 0) + (v.shipping ?? 0) - (v.discount ?? 0);
    const good = Math.abs(cents(expected) - cents(v.total)) <= 1;
    ok = (ok ?? true) && good;
    if (!good) notes.push(`Subtotal + tax${v.shipping ? " + shipping" : ""}${v.discount ? " − discount" : ""} = ${expected.toFixed(2)}, total is ${v.total.toFixed(2)}`);
  } else if (v.lines.length && v.lines.every((l) => l.amount !== null) && v.total !== null && v.subtotal === null) {
    const good = Math.abs(cents(lineSum + (v.tax ?? 0)) - cents(v.total)) <= 1;
    ok = good;
    if (!good) notes.push(`Lines${v.tax ? " + tax" : ""} add up to ${(lineSum + (v.tax ?? 0)).toFixed(2)}, total is ${v.total.toFixed(2)}`);
  }
  v.check = { ok, note: notes.join("; ") };
}
