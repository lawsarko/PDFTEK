import "server-only";
import ExcelJS from "exceljs";
import type { Invoice, InvoiceResult, StatementResult } from "./fin-extract";

/**
 * Spreadsheets built from statement and invoice results: real dates and numbers (so SUM and pivot
 * tables work), frozen header rows, filters, totals, and the rows that didn't add up highlighted.
 */

export type Named<T> = { name: string; result: T };

const MONEY = '#,##0.00;[Red]-#,##0.00';
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const FLAG_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
const OK_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF15803D" }, bold: true };
const BAD_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFB91C1C" }, bold: true };

/** Excel date from YYYY-MM-DD (UTC, so no time zone shifts the day). */
const xlDate = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; money?: boolean; date?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : c.date ? { numFmt: "yyyy-mm-dd" } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = HEAD_FILL;
  head.alignment = { vertical: "middle" };
  head.height = 20;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

const label = (n: Named<StatementResult>) => n.result.accountNumber || n.name.replace(/\.pdf$/i, "");

// ---------- statements ----------

export async function statementsXlsx(list: Named<StatementResult>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "pdftek";
  const many = list.length > 1;

  const tx = sheet(wb, "Transactions", [
    { header: "Date", key: "date", width: 12, date: true },
    { header: "Description", key: "description", width: 60 },
    { header: "Money out", key: "out", width: 14, money: true },
    { header: "Money in", key: "in", width: 14, money: true },
    { header: "Amount", key: "amount", width: 14, money: true },
    { header: "Balance", key: "balance", width: 15, money: true },
    ...(many ? [{ header: "Statement", key: "statement", width: 28 }] : []),
    { header: "Page", key: "page", width: 7 },
    { header: "Check", key: "check", width: 34 },
  ]);
  for (const s of list) {
    for (const t of s.result.transactions) {
      const row = tx.addRow({
        date: xlDate(t.date),
        description: t.description,
        out: t.amount < 0 ? -t.amount : null,
        in: t.amount > 0 ? t.amount : null,
        amount: t.amount,
        balance: t.balance,
        statement: label(s),
        page: t.page,
        check: t.flag ?? "",
      });
      if (t.flag) row.fill = FLAG_FILL;
    }
  }
  const last = tx.rowCount;
  if (last > 1) {
    const total = tx.addRow({ description: "Total" });
    total.font = { bold: true };
    for (const key of ["out", "in", "amount"]) {
      const col = tx.getColumn(key).letter;
      total.getCell(key).value = { formula: `SUBTOTAL(9,${col}2:${col}${last})` };
    }
    total.border = { top: { style: "thin" } };
  }

  const sum = sheet(wb, "Summary", [
    { header: "File", key: "file", width: 30 },
    { header: "Bank", key: "bank", width: 22 },
    { header: "Account holder", key: "holder", width: 24 },
    { header: "Account", key: "account", width: 18 },
    { header: "Currency", key: "currency", width: 9 },
    { header: "From", key: "from", width: 12, date: true },
    { header: "To", key: "to", width: 12, date: true },
    { header: "Opening balance", key: "opening", width: 16, money: true },
    { header: "Money in", key: "in", width: 14, money: true },
    { header: "Money out", key: "out", width: 14, money: true },
    { header: "Closing balance", key: "closing", width: 16, money: true },
    { header: "Transactions", key: "count", width: 13 },
    { header: "Reconciled", key: "reconciled", width: 30 },
  ]);
  for (const s of list) {
    const r = s.result;
    const row = sum.addRow({
      file: s.name,
      bank: r.bank,
      holder: r.accountHolder,
      account: r.accountNumber,
      currency: r.currency,
      from: xlDate(r.periodStart),
      to: xlDate(r.periodEnd),
      opening: r.openingBalance,
      in: r.check.moneyIn,
      out: r.check.moneyOut,
      closing: r.closingBalance,
      count: r.transactions.length,
      reconciled: reconciledText(r),
    });
    row.getCell("reconciled").font = r.check.reconciled ? OK_FONT : r.check.reconciled === false ? BAD_FONT : {};
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reconciledText(r: StatementResult) {
  if (r.check.reconciled) return r.check.balanceBreaks ? `Yes (check ${r.check.balanceBreaks} row${r.check.balanceBreaks > 1 ? "s" : ""})` : "Yes ✓";
  if (r.check.reconciled === false) return `No: off by ${Math.abs(r.check.difference ?? 0).toFixed(2)}`;
  return "Balances not shown";
}

export function statementsCsv(list: Named<StatementResult>[]): string {
  const many = list.length > 1;
  const rows: (string | number | null)[][] = [["Date", "Description", "Amount", "Balance", ...(many ? ["Statement"] : [])]];
  for (const s of list) for (const t of s.result.transactions) rows.push([t.date, t.description, t.amount.toFixed(2), t.balance?.toFixed(2) ?? "", ...(many ? [label(s)] : [])]);
  return toCsv(rows);
}

// ---------- invoices ----------

const invoiceCells = (file: string, v: Invoice) => ({
  file,
  vendor: v.vendor,
  number: v.invoiceNumber,
  date: xlDate(v.invoiceDate),
  due: xlDate(v.dueDate),
  po: v.poNumber,
  billTo: v.billTo,
  currency: v.currency,
  subtotal: v.subtotal,
  tax: v.tax,
  shipping: v.shipping,
  discount: v.discount,
  total: v.total,
  amountDue: v.amountDue,
  terms: v.paymentTerms,
  taxId: v.vendorTaxId,
  lines: v.lines.length,
  check: v.check.ok === false ? v.check.note : v.check.ok ? "Adds up ✓" : "",
});

export async function invoicesXlsx(list: Named<InvoiceResult>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "pdftek";
  const inv = sheet(wb, "Invoices", [
    { header: "File", key: "file", width: 26 },
    { header: "Vendor", key: "vendor", width: 26 },
    { header: "Invoice #", key: "number", width: 16 },
    { header: "Invoice date", key: "date", width: 13, date: true },
    { header: "Due date", key: "due", width: 12, date: true },
    { header: "PO #", key: "po", width: 12 },
    { header: "Bill to", key: "billTo", width: 26 },
    { header: "Currency", key: "currency", width: 9 },
    { header: "Subtotal", key: "subtotal", width: 13, money: true },
    { header: "Tax", key: "tax", width: 12, money: true },
    { header: "Shipping", key: "shipping", width: 11, money: true },
    { header: "Discount", key: "discount", width: 11, money: true },
    { header: "Total", key: "total", width: 13, money: true },
    { header: "Amount due", key: "amountDue", width: 13, money: true },
    { header: "Terms", key: "terms", width: 12 },
    { header: "Vendor tax ID", key: "taxId", width: 16 },
    { header: "Lines", key: "lines", width: 7 },
    { header: "Check", key: "check", width: 40 },
  ]);
  const lines = sheet(wb, "Line items", [
    { header: "Vendor", key: "vendor", width: 26 },
    { header: "Invoice #", key: "number", width: 16 },
    { header: "Invoice date", key: "date", width: 13, date: true },
    { header: "Description", key: "description", width: 56 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Unit price", key: "unit", width: 13, money: true },
    { header: "Amount", key: "amount", width: 13, money: true },
    { header: "Currency", key: "currency", width: 9 },
    { header: "File", key: "file", width: 26 },
  ]);
  for (const f of list)
    for (const v of f.result.invoices) {
      const row = inv.addRow(invoiceCells(f.name, v));
      if (v.check.ok === false) row.fill = FLAG_FILL;
      for (const l of v.lines)
        lines.addRow({ vendor: v.vendor, number: v.invoiceNumber, date: xlDate(v.invoiceDate), description: l.description, qty: l.quantity, unit: l.unitPrice, amount: l.amount, currency: v.currency, file: f.name });
    }
  const last = inv.rowCount;
  if (last > 1) {
    const total = inv.addRow({ file: "Total" });
    total.font = { bold: true };
    for (const key of ["subtotal", "tax", "total", "amountDue"]) {
      const col = inv.getColumn(key).letter;
      total.getCell(key).value = { formula: `SUBTOTAL(9,${col}2:${col}${last})` };
    }
    total.border = { top: { style: "thin" } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One row per line item with the invoice details repeated: the shape bill-import tools expect. */
export function invoicesCsv(list: Named<InvoiceResult>[]): string {
  const rows: (string | number | null)[][] = [["Vendor", "Invoice #", "Invoice date", "Due date", "Currency", "Description", "Quantity", "Unit price", "Line amount", "Subtotal", "Tax", "Total", "File"]];
  const n = (v: number | null) => (v === null ? "" : String(v));
  for (const f of list)
    for (const v of f.result.invoices) {
      const head = [v.vendor, v.invoiceNumber, v.invoiceDate, v.dueDate, v.currency];
      const tail = [n(v.subtotal), n(v.tax), n(v.total), f.name];
      if (!v.lines.length) rows.push([...head, "", "", "", "", ...tail]);
      for (const l of v.lines) rows.push([...head, l.description, n(l.quantity), n(l.unitPrice), n(l.amount), ...tail]);
    }
  return toCsv(rows);
}

function toCsv(rows: (string | number | null)[][]) {
  // Leading formula characters are neutralised so a crafted description can't run in Excel.
  const cell = (v: string | number | null) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
