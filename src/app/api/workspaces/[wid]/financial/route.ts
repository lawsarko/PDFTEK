import { badRequest, route, HttpError } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { getDocument } from "@/lib/documents";
import { requireMembership } from "@/lib/billing";
import { cachedResult, type InvoiceResult, type StatementResult } from "@/lib/fin-extract";
import { invoicesCsv, invoicesXlsx, statementsCsv, statementsXlsx, type Named } from "@/lib/fin-workbook";

type P = { params: Promise<{ wid: string }> };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Downloads already-read statements or invoices as one spreadsheet (xlsx) or CSV. One document is
 * free to download; combining several into one file is a Day Pass / Pro feature.
 */
export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const format = url.searchParams.get("format") ?? "xlsx";
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").filter(Boolean))];
  if (kind !== "statement" && kind !== "invoice") throw badRequest("Unknown kind.");
  if (format !== "xlsx" && format !== "csv") throw badRequest("Unknown format.");
  if (!ids.length || ids.length > 100) throw badRequest("Choose between 1 and 100 documents.");
  if (ids.length > 1) requireMembership(ctx, "Bulk conversion (several files into one spreadsheet)");

  const list: Named<StatementResult | InvoiceResult>[] = ids.map((id) => {
    const doc = getDocument(ctx, id);
    const result = cachedResult(doc, kind);
    if (!result) throw new HttpError(409, `${doc.name} hasn't been read yet.`);
    return { name: doc.name, result };
  });

  const base = ids.length > 1 ? (kind === "statement" ? "Bank statements" : "Invoices") : list[0].name.replace(/\.pdf$/i, "");
  let bytes: Buffer | string;
  if (kind === "statement") {
    const s = list as Named<StatementResult>[];
    bytes = format === "xlsx" ? await statementsXlsx(s) : statementsCsv(s);
  } else {
    const v = list as Named<InvoiceResult>[];
    bytes = format === "xlsx" ? await invoicesXlsx(v) : invoicesCsv(v);
  }
  const filename = `${base}.${format}`;
  return new Response(typeof bytes === "string" ? bytes : new Uint8Array(bytes), {
    headers: {
      "content-type": format === "xlsx" ? XLSX : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
});
