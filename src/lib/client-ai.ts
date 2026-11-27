import "server-only";
import ExcelJS from "exceljs";
import { all, get, run, update } from "./db";
import { now } from "./ids";
import { HttpError, badRequest } from "./http";
import { sendMail, mailConfigured } from "./mail";
import { notify } from "./activity";
import { AI_MODEL, structured, type UsageHook } from "./ai";
import { chargeAi, chargeAiWorkspace, assertAiCredits } from "./billing";
import { readPages, pageBlocks } from "./fin-extract";
import { getDocument, readCurrentPdf } from "./documents";
import { ensureSlug, firmDisplayName, firmOf, portalUrl } from "./firm";
import { getClient, type ClientRow } from "./clients";
import { logEvent, type ItemRow, type RequestRow } from "./requests";
import { TAX_FORMS } from "./client-shared";
import type { Ctx } from "./auth";

/**
 * AI help for firms:
 *  - checkUpload: every file a client uploads is identified (form, tax year, issuer), checked against
 *    what was asked for (wrong year, wrong form, unreadable, pages missing), given a clear name and
 *    filed. Key amounts are kept for the year-end summary. Problems go straight back to the client.
 *  - priorYearChecklist: reads last year's return and lists the documents to ask for this year.
 *  - taxSummaryXlsx: one spreadsheet of the amounts found in a client's documents for a year.
 */

const CHECK_MODEL = process.env.PDFTEK_AI_CHECK_MODEL || "claude-sonnet-5-5";

type Check = {
  formType: (typeof TAX_FORMS)[number];
  taxYear: number | null;
  issuer: string;
  taxpayer: string;
  summary: string;
  matchesRequest: boolean;
  problems: string[];
  amounts: { label: string; amount: number }[];
  suggestedName: string;
};

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["formType", "taxYear", "issuer", "taxpayer", "summary", "matchesRequest", "problems", "amounts", "suggestedName"],
  properties: {
    formType: { type: "string", enum: [...TAX_FORMS] },
    taxYear: { type: "integer", description: "The tax year the document covers (not the date it was printed). 0 if none." },
    issuer: { type: "string", description: "Employer, bank, broker or other issuer, as printed. Empty if none." },
    taxpayer: { type: "string", description: "Whose document it is (recipient / account holder), as printed. Empty if unclear." },
    summary: { type: "string", description: "One short sentence describing the document, e.g. '2025 W-2 from Acme Corp for Jane Smith'." },
    matchesRequest: { type: "boolean", description: "True when this is the kind of document the checklist item asks for." },
    problems: {
      type: "array",
      items: { type: "string" },
      description: "Only clear, specific problems the client can fix, each one plain sentence addressed to the client. Empty when the document is fine.",
    },
    amounts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount"],
        properties: { label: { type: "string", description: "Box and name, e.g. 'Box 1 Wages, tips, other compensation'." }, amount: { type: "number" } },
      },
      description: "Key dollar amounts from tax forms (W-2 boxes 1, 2, 3, 4, 5, 6, 16, 17; 1099-INT box 1; 1099-DIV 1a, 1b, 2a; 1099-NEC box 1; 1099-MISC boxes 1–3; 1099-R 1, 2a, 4; 1099-B proceeds and basis totals; SSA-1099 box 5; 1098 box 1, 10; 1098-T 1, 5; 1098-E 1; 1095-A annual totals; K-1 key lines). Empty for statements, receipts, IDs.",
    },
    suggestedName: { type: "string", description: "A clear file name without extension: '<year> <form> – <issuer>', e.g. '2025 W-2 – Acme Corp'. Under 80 characters." },
  },
} as const;

const CHECK_SYSTEM = `You check documents that clients upload to their tax preparer or accountant through a secure portal.
For each upload you get: the checklist item the firm asked for, the tax year it's for, and the first pages of the file.
Identify the document, its tax year and issuer, and whether it's what the item asks for.

Report a problem ONLY when you are confident and the client can fix it:
- a different tax year than requested (e.g. a 2024 W-2 when 2025 was requested),
- clearly not the requested kind of document (a bank statement uploaded for "W-2"),
- unreadable: too blurry, dark, cut off or rotated to read the key numbers,
- obviously incomplete: a page or the part with the amounts is missing, or only the envelope/cover was uploaded,
- a blank page or a password screen.
Write problems as one friendly sentence to the client, e.g. "This looks like your 2024 W-2, but we need the one for 2025."
Don't flag stylistic issues, minor glare, extra pages, or a different but acceptable variant (a corrected W-2c for a W-2 item is fine; a 1099 composite statement satisfies 1099-DIV/INT/B items).
When the item is generic ("Other documents", "Receipts"), anything relevant matches.
Copy amounts exactly as printed (plain numbers, no $ or commas). Never invent values.`;

/** Runs after a client's upload (in the background). */
export async function checkUpload(requestId: string, itemId: string) {
  const r = get<RequestRow>("SELECT * FROM doc_requests WHERE id = ?", requestId);
  const item = get<ItemRow>("SELECT * FROM doc_request_items WHERE id = ? AND request_id = ?", itemId, requestId);
  if (!r || !item || !item.document_id || !r.client_id) return;
  const c = get<ClientRow>("SELECT * FROM clients WHERE id = ?", r.client_id);
  if (!c) return;
  const docId = item.document_id;
  try {
    const doc = getDocument({ workspace: { id: r.workspace_id } } as Ctx, docId);
    const parts = await readPages(new Uint8Array(await readCurrentPdf(doc)), { maxPages: 3 });
    const year = r.year;
    const result = await structured<Check>({
      system: CHECK_SYSTEM,
      content: [
        ...pageBlocks(parts),
        {
          type: "text",
          text: `Checklist item: "${item.label}"${item.note ? ` (note: ${item.note})` : ""}.\nRequest: "${r.title}".\nTax year requested: ${year ?? "not specified"}.\nClient: ${c.name}${c.spouse_name ? ` and ${c.spouse_name}` : ""}${c.company ? ` (${c.company})` : ""}.`,
        },
      ],
      schema: CHECK_SCHEMA,
      effort: "low",
      maxTokens: 4000,
      model: CHECK_MODEL,
      onUsage: (model, usage) => chargeAiWorkspace(r.workspace_id, model, usage, "Client upload check"),
    });
    // The item may have been replaced while this ran.
    const cur = get<{ document_id: string | null }>("SELECT document_id FROM doc_request_items WHERE id = ?", item.id);
    if (cur?.document_id !== docId) return;
    if (!result.taxYear) result.taxYear = null;
    const problems = result.problems.map((p) => p.trim()).filter(Boolean).slice(0, 4);
    const flagged = problems.length > 0;
    const saved = { formType: result.formType, taxYear: result.taxYear, issuer: result.issuer, summary: result.summary, problems, suggestedName: result.suggestedName };
    update("doc_request_items", item.id, { ai_status: flagged ? "flagged" : "ok", ai_json: JSON.stringify(saved) });
    const name = cleanName(result.suggestedName) || item.label;
    run("UPDATE documents SET name = ?, updated_at = ? WHERE id = ?", `${name} — ${c.name}.pdf`, now(), docId);
    run(
      "UPDATE client_files SET ai_json = ?, category = ?, year = COALESCE(?, year) WHERE client_id = ? AND document_id = ?",
      JSON.stringify({ ...saved, taxpayer: result.taxpayer, amounts: result.amounts.filter((a) => Number.isFinite(a.amount)).slice(0, 30) }),
      result.formType === "Other" ? item.label.slice(0, 120) : result.formType,
      result.taxYear && result.taxYear > 1990 && result.taxYear < 2100 ? result.taxYear : null,
      c.id,
      docId,
    );
    logEvent(r.id, flagged ? "ai_flagged" : "ai_ok", flagged ? `${item.label}: ${problems.join(" ")}` : `${item.label}: ${result.summary}`);
    if (flagged) {
      notify({ userId: c.assigned_to ?? c.created_by, workspaceId: r.workspace_id, title: `Check ${c.name}'s upload: ${item.label}`, body: problems[0], link: `/app/${r.workspace_id}/clients/${c.id}` });
      if (mailConfigured()) {
        const firm = firmDisplayName(firmOf(r.workspace_id));
        void sendMail({
          to: c.email,
          subject: `Please check your upload: ${item.label}`,
          heading: "We noticed something about your upload",
          paragraphs: [`Hi ${c.name.split(" ")[0]}, thanks for uploading "${item.label}" for ${firm}.`, ...problems, "If it's right as it is, there's nothing to do. Otherwise, please upload a new copy in your portal."],
          cta: { label: "Open my portal", url: portalUrl(ensureSlug(r.workspace_id)) },
          footer: `Sent by pdftek for ${firm}. This check is automatic; ${firm} reviews every document.`,
        });
      }
    }
  } catch (err) {
    console.error("[pdftek] upload check failed", requestId, itemId, err);
    run("UPDATE doc_request_items SET ai_status = 'skipped' WHERE id = ? AND document_id = ?", item.id, docId);
  }
}

const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

// ---------- checklist from last year's return ----------

type Suggested = { taxYear: number | null; taxpayers: string; items: { label: string; note: string; required: boolean }[] };

const CHECKLIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taxYear", "taxpayers", "items"],
  properties: {
    taxYear: { type: "integer", description: "Tax year of the return. 0 if unclear." },
    taxpayers: { type: "string", description: "Name(s) on the return." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "note", "required"],
        properties: {
          label: { type: "string", description: "What to upload, specific to the source, e.g. 'W-2 from Acme Corp' or '1099-INT from Chase Bank'. Under 70 characters." },
          note: { type: "string", description: "Short hint for the client, e.g. 'Last year you had interest income from this account.' Under 120 characters." },
          required: { type: "boolean", description: "False for items that may not recur (one-off sales, energy credits)." },
        },
      },
    },
  },
} as const;

const CHECKLIST_SYSTEM = `You help a US tax preparer build next year's document request list from a client's prior-year return (Form 1040 or a business return with schedules).
Read every income source, deduction and credit on the return and list the documents the client must provide for the next tax year:
- one item per employer W-2, per bank/broker 1099 (INT, DIV, B, composite), per payer 1099-NEC/MISC/R/G/K/SSA, K-1s per entity,
- Schedule C: income records, expense records/receipts, 1099-NEC/K received, vehicle mileage log, home office details,
- Schedule E: rents received, expenses per property, 1098 per mortgage,
- itemized deductions: 1098 mortgage interest, property tax bills, charitable receipts, medical expenses if they were itemized,
- education (1098-T, 1098-E), HSA (1099-SA, 5498-SA), marketplace insurance (1095-A), childcare provider statements for the dependent care credit, estimated tax payments made,
- always add "Any new income or life changes (new job, home sale, marriage, baby)" as an optional item, and a photo ID item only if this looks like a new client.
Use the payer names exactly as printed. Don't list documents for things that don't appear on the return. Keep the list to what's needed, typically 5–25 items.`;

export async function priorYearChecklist(ctx: Ctx, documentId: string) {
  assertAiCredits(ctx);
  const doc = getDocument(ctx, documentId);
  if (doc.page_count > 80) throw badRequest("That return is over 80 pages. Upload just the 1040 and schedules.");
  const parts = await readPages(new Uint8Array(await readCurrentPdf(doc)), { maxPages: 40 });
  if (!parts.length) throw badRequest("That file has no pages.");
  const charge: UsageHook = (model, usage) => chargeAi(ctx, model, usage, "Checklist from prior-year return");
  const out = await structured<Suggested>({
    system: CHECKLIST_SYSTEM,
    content: [...pageBlocks(parts), { type: "text", text: "Build the document request list for the next tax year from this return." }],
    schema: CHECKLIST_SCHEMA,
    effort: "medium",
    maxTokens: 12000,
    model: AI_MODEL,
    onUsage: charge,
  });
  if (!out.taxYear) out.taxYear = null;
  return {
    taxYear: out.taxYear,
    nextYear: out.taxYear ? out.taxYear + 1 : null,
    taxpayers: out.taxpayers,
    items: out.items.slice(0, 25).map((i) => ({ label: i.label.slice(0, 200), note: i.note.slice(0, 300), required: i.required })),
  };
}

// ---------- year-end summary spreadsheet ----------

type Saved = { formType?: string; taxYear?: number | null; issuer?: string; taxpayer?: string; summary?: string; amounts?: { label: string; amount: number }[] };

export async function taxSummaryXlsx(ctx: Ctx, clientId: string, year: number) {
  const c = getClient(ctx.workspace.id, clientId);
  const files = all<{ ai_json: string | null; name: string; category: string; created_at: number }>(
    `SELECT f.ai_json, d.name, f.category, f.created_at FROM client_files f JOIN documents d ON d.id = f.document_id
      WHERE f.client_id = ? AND f.year = ? AND d.deleted_at IS NULL ORDER BY f.created_at`,
    c.id,
    year,
  );
  if (!files.length) throw new HttpError(404, `No documents are filed under ${year} for ${c.name} yet.`);
  const wb = new ExcelJS.Workbook();
  wb.creator = "pdftek";
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB84A0B" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const amounts = wb.addWorksheet("Amounts");
  amounts.columns = [
    { header: "Form", key: "form", width: 14 },
    { header: "Issuer", key: "issuer", width: 30 },
    { header: "For", key: "taxpayer", width: 24 },
    { header: "Box / item", key: "label", width: 44 },
    { header: "Amount", key: "amount", width: 16, style: { numFmt: "#,##0.00" } },
    { header: "Document", key: "doc", width: 44 },
  ];
  head(amounts);
  const docs = wb.addWorksheet("Documents");
  docs.columns = [
    { header: "Document", key: "doc", width: 50 },
    { header: "Form", key: "form", width: 16 },
    { header: "Tax year", key: "year", width: 10 },
    { header: "Issuer", key: "issuer", width: 30 },
    { header: "What it is", key: "summary", width: 60 },
  ];
  head(docs);
  let n = 0;
  for (const f of files) {
    const s = (f.ai_json ? JSON.parse(f.ai_json) : {}) as Saved;
    docs.addRow({ doc: f.name, form: s.formType ?? f.category, year: s.taxYear ?? year, issuer: s.issuer ?? "", summary: s.summary ?? "" });
    for (const a of s.amounts ?? []) {
      amounts.addRow({ form: s.formType ?? f.category, issuer: s.issuer ?? "", taxpayer: s.taxpayer ?? "", label: a.label, amount: a.amount, doc: f.name });
      n++;
    }
  }
  if (!n) amounts.addRow({ label: "No amounts were read from these documents yet (they're read when clients upload through a request)." });
  amounts.addRow({});
  amounts.addRow({ label: "Read automatically from the uploaded documents. Check every figure against the source before filing." }).font = { italic: true, color: { argb: "FF6D5E54" } };
  return { data: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${c.name} — ${year} document summary.xlsx` };
}
