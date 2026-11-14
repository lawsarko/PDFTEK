"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, download, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import type { Entitlements } from "@/lib/plans";
import type { FinKind, FinResult, InvoiceResult, StatementResult } from "@/lib/fin-extract";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { notifyPaywall } from "@/components/paywall";
import { useToast } from "@/components/toast";

/**
 * Statements & invoices to Excel, plus bulk PDF → Word/Excel.
 *
 * Files are read one request per document (each shows its own progress and can be retried), then
 * downloaded one by one or combined into a single workbook. Reading several at once and combining
 * them is the paid "bulk" part; one document at a time works for everyone.
 */

type Mode = FinKind | "bulk";
type Item = { doc: Doc; status: "queued" | "reading" | "done" | "error"; result?: FinResult; error?: string };

const MODES: { key: Mode; label: string; icon: React.ReactNode }[] = [
  { key: "statement", label: "Bank statements", icon: <I.table size={14} /> },
  { key: "invoice", label: "Invoices & receipts", icon: <I.file size={14} /> },
  { key: "bulk", label: "Bulk convert", icon: <I.layers size={14} /> },
];

const COPY: Record<Mode, { title: string; lead: string; drop: string }> = {
  statement: {
    title: "Bank statements to Excel",
    lead: "Turn PDF bank and credit card statements into clean transaction rows: date, description, money in, money out and balance. Every statement is checked against its running and closing balances.",
    drop: "Drop bank or credit card statements (PDF), or browse",
  },
  invoice: {
    title: "Invoices & receipts to Excel",
    lead: "Pull vendor, invoice number, dates, line items, tax and totals out of invoices and receipts, one row per invoice plus a line-item sheet. Totals are checked so mistakes stand out.",
    drop: "Drop invoices or receipts (PDF), or browse",
  },
  bulk: {
    title: "Bulk convert PDFs",
    lead: "Convert many PDFs to Word or Excel in one go and download them together as a ZIP file.",
    drop: "Drop PDFs to convert, or browse",
  },
};

const money = (n: number | null | undefined, currency = "") =>
  n === null || n === undefined ? "–" : `${n < 0 ? "-" : ""}${currency && currency.length === 3 ? `${currency} ` : ""}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ToExcel({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const initial = params.get("kind");
  const [mode, setMode] = useState<Mode>(initial === "invoice" || initial === "bulk" ? initial : "statement");
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [library, setLibrary] = useState<Doc[]>([]);
  const [items, setItems] = useState<Record<Mode, Item[]>>({ statement: [], invoice: [], bulk: [] });
  const [preview, setPreview] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [target, setTarget] = useState<"docx" | "xlsx">("xlsx");
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(new Set<string>());
  const restoredRef = useRef(false);

  const loadEnt = useCallback(() => api<Entitlements>(`/api/workspaces/${wid}/usage`).then(setEnt).catch(() => {}), [wid]);
  useEffect(() => {
    void loadEnt();
    api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`)
      .then((r) => {
        setLibrary(r.documents);
        // Bring back the lists from before a checkout redirect (results are cached, so this is free).
        const restored: Record<Mode, Item[]> = { statement: [], invoice: [], bulk: [] };
        for (const m of ["statement", "invoice", "bulk"] as const) {
          let ids: string[] = [];
          try {
            ids = JSON.parse(sessionStorage.getItem(`fx:${wid}:${m}`) ?? "[]");
          } catch {}
          restored[m] = ids.flatMap((id) => r.documents.filter((d) => d.id === id)).map((doc): Item => ({ doc, status: "queued" }));
        }
        // Opened from a document's Convert menu: start with that document.
        const pre = r.documents.find((d) => d.id === params.get("doc"));
        if (pre && initial !== "bulk") {
          const m: FinKind = initial === "invoice" ? "invoice" : "statement";
          if (!restored[m].some((i) => i.doc.id === pre.id)) restored[m].push({ doc: pre, status: "queued" });
          setPreview(pre.id);
        }
        restoredRef.current = true;
        // Merge, in case a file was added while the library was loading.
        setItems((all) => {
          const next = { ...all };
          for (const m of ["statement", "invoice", "bulk"] as const) next[m] = [...restored[m].filter((x) => !all[m].some((y) => y.doc.id === x.doc.id)), ...all[m]];
          return next;
        });
      })
      .catch(() => {});
    const on = () => void loadEnt();
    window.addEventListener("pdftek:usage", on);
    return () => window.removeEventListener("pdftek:usage", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, loadEnt]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setPreview(null);
    router.replace(`/app/${wid}/to-excel?kind=${m}`, { scroll: false });
  };

  const list = items[mode];
  const member = ent?.membership ?? false;
  const credits = ent ? ent.credits + ent.allowance : 0;

  const patch = useCallback((m: Mode, docId: string, p: Partial<Item>) => setItems((all) => ({ ...all, [m]: all[m].map((it) => (it.doc.id === docId ? { ...it, ...p } : it)) })), []);

  const read = useCallback(
    async (m: FinKind, doc: Doc, refresh = false) => {
      patch(m, doc.id, { status: "reading", error: undefined });
      try {
        const r = await api<{ result: FinResult }>(`/api/documents/${doc.id}/financial`, { method: "POST", json: { kind: m, refresh } });
        patch(m, doc.id, { status: "done", result: r.result });
        setPreview((p) => p ?? doc.id);
      } catch (e) {
        patch(m, doc.id, { status: "error", error: errMsg(e) });
      }
    },
    [patch],
  );

  // Work through the queues, two documents at a time (each is already read in parallel inside).
  useEffect(() => {
    for (const m of ["statement", "invoice"] as const) {
      const reading = items[m].filter((i) => i.status === "reading").length;
      for (const it of items[m].filter((i) => i.status === "queued").slice(0, Math.max(0, 2 - reading))) {
        // Effects can run twice for one change; never start (and pay for) the same read twice.
        if (started.current.has(`${m}:${it.doc.id}`)) continue;
        started.current.add(`${m}:${it.doc.id}`);
        void read(m, it.doc);
      }
    }
  }, [items, read]);

  useEffect(() => {
    if (!restoredRef.current) return; // don't overwrite the saved lists before they're restored
    for (const m of ["statement", "invoice", "bulk"] as const) {
      try {
        sessionStorage.setItem(`fx:${wid}:${m}`, JSON.stringify(items[m].map((i) => i.doc.id)));
      } catch {}
    }
  }, [items, wid]);

  /** Several files at once is the paid "bulk" feature. */
  const needsBulk = (count: number) => {
    if (member || count <= 1) return false;
    notifyPaywall({
      code: "membership_required",
      message: "Converting several files at once needs a Day Pass ($1.99 for 24 hours) or pdftek Pro. Without one, add files one at a time.",
    });
    return true;
  };

  const add = (docs: Doc[]) => {
    const pdfs = docs.filter((d) => d.status !== "failed");
    setItems((all) => {
      const cur = all[mode];
      const fresh = pdfs.filter((d) => !cur.some((c) => c.doc.id === d.id)).map((doc): Item => ({ doc, status: "queued" }));
      return { ...all, [mode]: [...cur, ...fresh] };
    });
    if (mode !== "bulk" && pdfs[0]) setPreview(pdfs[0].id);
  };

  const upload = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!pdfs.length) return toast("Choose PDF files.", "error");
    if (needsBulk(pdfs.length)) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of pdfs) form.append("files", f);
      const r = await api<{ documents: Doc[]; errors: { name: string; error: string }[] }>(`/api/workspaces/${wid}/documents`, { method: "POST", body: form });
      r.errors.forEach((e) => toast(`${e.name}: ${e.error}`, "error"));
      setLibrary((l) => [...r.documents, ...l.filter((d) => !r.documents.some((n) => n.id === d.id))]);
      add(r.documents);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = (id: string) => {
    started.current.delete(`${mode}:${id}`);
    setItems((all) => ({ ...all, [mode]: all[mode].filter((i) => i.doc.id !== id) }));
    if (preview === id) setPreview(null);
  };

  const fetchFile = async (ids: string[], format: "xlsx" | "csv") => {
    if (mode === "bulk") return;
    try {
      const blob = await api<Blob>(`/api/workspaces/${wid}/financial?kind=${mode}&format=${format}&ids=${ids.join(",")}`);
      const one = ids.length === 1 ? items[mode].find((i) => i.doc.id === ids[0])?.doc.name.replace(/\.pdf$/i, "") : null;
      download(blob, `${one ?? (mode === "statement" ? "Bank statements" : "Invoices")}.${format}`);
    } catch (e) {
      if (!(e instanceof Error && /Day Pass|Pro/.test(e.message))) toast(errMsg(e), "error");
    }
  };

  const bulkConvert = async () => {
    if (!member) return needsBulk(2);
    const docs = list.map((i) => i.doc);
    if (!docs.length) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const used = new Set<string>();
    setZipping({ done: 0, total: docs.length });
    let failed = 0;
    for (const [n, d] of docs.entries()) {
      patch("bulk", d.id, { status: "reading" });
      try {
        const blob = await api<Blob>(`/api/documents/${d.id}/convert?to=${target}`);
        let name = `${d.name.replace(/\.pdf$/i, "")}.${target}`;
        for (let k = 2; used.has(name.toLowerCase()); k++) name = `${d.name.replace(/\.pdf$/i, "")} (${k}).${target}`;
        used.add(name.toLowerCase());
        zip.file(name, blob);
        patch("bulk", d.id, { status: "done" });
      } catch (e) {
        failed++;
        patch("bulk", d.id, { status: "error", error: errMsg(e) });
      }
      setZipping({ done: n + 1, total: docs.length });
    }
    if (docs.length - failed > 0) {
      const out = await zip.generateAsync({ type: "blob" });
      download(out, `pdftek ${target === "docx" ? "Word" : "Excel"} files.zip`);
      toast(failed ? `${docs.length - failed} converted, ${failed} failed` : `${docs.length} files converted`, failed ? "error" : "success");
    }
    setZipping(null);
  };

  const done = list.filter((i) => i.status === "done");
  const selected = list.find((i) => i.doc.id === preview && i.result);
  const copy = COPY[mode];
  const pdfLibrary = library.filter((d) => d.status !== "failed");

  return (
    <AppShell wid={wid} title="Statements & invoices to Excel">
      <div className="shell fx">
        <div className="fx-tabs" role="tablist">
          {MODES.map((m) => (
            <button key={m.key} role="tab" aria-selected={mode === m.key} className={`fx-tab ${mode === m.key ? "on" : ""}`} onClick={() => switchMode(m.key)}>
              {m.icon} {m.label}
              {m.key === "bulk" && !member && <span className="badge badge-warn">Pro</span>}
            </button>
          ))}
        </div>
        <h1 style={{ marginTop: 18 }}>{copy.title}</h1>
        <p className="muted fx-lead">{copy.lead}</p>

        <div className="fx-plan small">
          {mode === "bulk" ? (
            member ? (
              <span><I.check size={13} /> Bulk conversion is included in your plan.</span>
            ) : (
              <span><I.lock size={13} /> Bulk conversion is part of the Day Pass ($1.99) and Pro. You can still convert single files from the workbench for free.</span>
            )
          ) : (
            <>
              <span>
                <I.sparkle size={13} /> Uses AI credits, about 6 per page. Your first document each month (up to 10 pages) is free.
                {ent && <> Balance: <b>{credits.toLocaleString()}</b> credits.</>}
              </span>
              {!member && <span><I.lock size={13} /> Several files at once and combined spreadsheets need a Day Pass or Pro.</span>}
            </>
          )}
        </div>

        <div
          className={`dropzone fx-drop ${over ? "over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void upload([...e.dataTransfer.files]);
          }}
        >
          {uploading ? <span className="spinner" /> : <I.upload size={24} />}
          <div style={{ marginTop: 8, fontWeight: 500 }}>
            {uploading ? "Uploading…" : <>{copy.drop.replace(", or browse", "")}, or <span style={{ color: "var(--amber)" }}>browse</span></>}
          </div>
          <div className="tiny faint" style={{ marginTop: 4 }}>
            {member ? `Up to ${ent?.maxFiles ?? 50} files at a time · ${ent?.maxFileMb ?? 100} MB each` : `One file at a time on the free plan · up to ${ent?.maxFileMb ?? 20} MB`}
          </div>
          <input ref={input} type="file" accept=".pdf,application/pdf" multiple={member} hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
        </div>
        {pdfLibrary.length > 0 && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setPicking(true)}>
              <I.folder size={13} /> Choose from your library
            </button>
          </div>
        )}

        {list.length > 0 && (
          <div className="fx-queue">
            {list.map((it) => (
              <QueueRow
                key={it.doc.id}
                item={it}
                mode={mode}
                active={preview === it.doc.id}
                onPreview={() => setPreview(it.doc.id)}
                onRetry={() => mode !== "bulk" && void read(mode, it.doc, true)}
                onRemove={() => remove(it.doc.id)}
                onDownload={(f) => void fetchFile([it.doc.id], f)}
              />
            ))}
          </div>
        )}

        {mode === "bulk" && list.length > 0 && (
          <div className="fx-actions">
            <div className="row gap-8 wrap">
              <span className="small muted">Convert to</span>
              <button className={`chip ${target === "xlsx" ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setTarget("xlsx")}>Excel (.xlsx)</button>
              <button className={`chip ${target === "docx" ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setTarget("docx")}>Word (.docx)</button>
            </div>
            <button className="btn btn-primary" disabled={!!zipping} onClick={() => void bulkConvert()}>
              {zipping ? <><span className="spinner" /> Converting {zipping.done}/{zipping.total}…</> : <><I.download size={14} /> Convert {list.length} file{list.length > 1 ? "s" : ""} &amp; download ZIP</>}
            </button>
          </div>
        )}

        {mode !== "bulk" && done.length > 1 && (
          <div className="fx-actions">
            <span className="small">
              <b>{done.length} files ready.</b> <span className="muted">Download them together in one spreadsheet.</span>
            </span>
            <div className="row gap-8">
              <button className="btn btn-primary" onClick={() => void fetchFile(done.map((i) => i.doc.id), "xlsx")}>
                <I.download size={14} /> All in one Excel file {!member && <I.lock size={12} />}
              </button>
              <button className="btn" onClick={() => void fetchFile(done.map((i) => i.doc.id), "csv")}>
                CSV {!member && <I.lock size={12} />}
              </button>
            </div>
          </div>
        )}

        {selected?.result && mode !== "bulk" && (
          <div className="fx-preview">
            {selected.result.kind === "statement" ? <StatementPreview name={selected.doc.name} r={selected.result} /> : <InvoicePreview r={selected.result} />}
          </div>
        )}

        {!list.length && mode !== "bulk" && (
          <div className="fx-how">
            {(mode === "statement"
              ? [
                  ["Any bank, any layout", "Checking, savings and credit card statements. Scanned statements work too."],
                  ["Checked, not just copied", "Running balances and the closing balance are verified; rows that don't add up are highlighted."],
                  ["Ready for your books", "Real dates and numbers in Excel, or a CSV for QuickBooks, Xero and other accounting software."],
                ]
              : [
                  ["Every field that matters", "Vendor, invoice number, dates, PO, bill-to, subtotal, tax, shipping, discount, total and amount due."],
                  ["Line items included", "A second sheet lists every line item with quantity, unit price and amount."],
                  ["Totals verified", "Line items and tax are checked against the total, so misreads stand out."],
                ]
            ).map(([h, p]) => (
              <div key={h} className="fx-how-card">
                <b>{h}</b>
                <span className="small muted">{p}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {picking && (
        <PickModal
          docs={pdfLibrary}
          multiple={member}
          onClose={() => setPicking(false)}
          onPick={(docs) => {
            setPicking(false);
            if (needsBulk(docs.length)) return;
            add(docs);
          }}
        />
      )}
    </AppShell>
  );
}

function QueueRow({ item, mode, active, onPreview, onRetry, onRemove, onDownload }: { item: Item; mode: Mode; active: boolean; onPreview: () => void; onRetry: () => void; onRemove: () => void; onDownload: (f: "xlsx" | "csv") => void }) {
  const r = item.result;
  let summary: React.ReactNode = null;
  if (r?.kind === "statement") {
    const c = r.check;
    summary = (
      <>
        {r.transactions.length} transactions
        {c.reconciled ? (
          <span className="badge badge-good">Reconciled ✓</span>
        ) : c.reconciled === false ? (
          <span className="badge badge-bad">Off by {money(Math.abs(c.difference ?? 0))}</span>
        ) : (
          <span className="badge badge-muted">No balances shown</span>
        )}
        {c.balanceBreaks > 0 && <span className="badge badge-warn">{c.balanceBreaks} to check</span>}
      </>
    );
  } else if (r?.kind === "invoice") {
    const bad = r.invoices.filter((v) => v.check.ok === false).length;
    summary = (
      <>
        {r.invoices.length} invoice{r.invoices.length === 1 ? "" : "s"}
        {r.invoices.length === 1 && r.invoices[0].total !== null && <> · total {money(r.invoices[0].total, r.invoices[0].currency)}</>}
        {bad ? <span className="badge badge-warn">{bad} to check</span> : r.invoices.length ? <span className="badge badge-good">Totals check ✓</span> : null}
      </>
    );
  }
  return (
    <div className={`fx-row ${active ? "on" : ""}`}>
      <I.file size={16} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis">{item.doc.name}</div>
        <div className="tiny muted row gap-8 wrap" style={{ marginTop: 2 }}>
          <span className="mono faint">{item.doc.pageCount} p</span>
          {item.status === "queued" && <span>Waiting…</span>}
          {item.status === "reading" && (
            <span>
              <span className="spinner" style={{ width: 10, height: 10 }} /> {mode === "bulk" ? "Converting…" : `Reading ${item.doc.pageCount} page${item.doc.pageCount === 1 ? "" : "s"}…`}
            </span>
          )}
          {item.status === "error" && <span style={{ color: "var(--bad)" }}>{item.error}</span>}
          {item.status === "done" && mode === "bulk" && <span style={{ color: "var(--good)" }}>Converted</span>}
          {summary}
        </div>
      </div>
      {item.status === "done" && mode !== "bulk" && (
        <div className="row gap-4 fx-row-actions">
          <button className="btn btn-sm btn-ghost" onClick={onPreview}>Preview</button>
          <button className="btn btn-sm" onClick={() => onDownload("xlsx")}>
            <I.download size={12} /> Excel
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onDownload("csv")}>CSV</button>
        </div>
      )}
      {item.status === "error" && mode !== "bulk" && (
        <button className="btn btn-sm" onClick={onRetry}>Retry</button>
      )}
      <button className="icon-btn" onClick={onRemove} aria-label="Remove" disabled={item.status === "reading"}>
        <I.x size={14} />
      </button>
    </div>
  );
}

function StatementPreview({ name, r }: { name: string; r: StatementResult }) {
  const [all, setAll] = useState(false);
  const rows = all ? r.transactions : r.transactions.slice(0, 100);
  const cur = r.currency;
  return (
    <>
      <div className="fx-facts">
        <Fact k="Account" v={[r.bank, r.accountNumber].filter(Boolean).join(" · ") || name} />
        {r.accountHolder && <Fact k="Holder" v={r.accountHolder} />}
        {(r.periodStart || r.periodEnd) && <Fact k="Period" v={`${r.periodStart || "?"} → ${r.periodEnd || "?"}`} />}
        <Fact k="Opening" v={money(r.openingBalance, cur)} />
        <Fact k="Money in" v={money(r.check.moneyIn, cur)} good />
        <Fact k="Money out" v={money(r.check.moneyOut, cur)} />
        <Fact k="Closing" v={money(r.closingBalance, cur)} />
      </div>
      {r.check.reconciled === false && (
        <div className="notice notice-bad small" style={{ marginBottom: 10 }}>
          Opening balance + transactions comes to {money((r.closingBalance ?? 0) + (r.check.difference ?? 0), cur)}, but the statement&apos;s closing balance is {money(r.closingBalance, cur)}. Check the highlighted rows against the PDF.
        </div>
      )}
      {r.check.signFixes > 0 && <p className="tiny faint" style={{ margin: "0 0 8px" }}>{r.check.signFixes} amount{r.check.signFixes > 1 ? "s were" : " was"} corrected from in to out (or back) because the running balance proved it.</p>}
      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Money out</th>
              <th className="num">Money in</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={i} className={t.flag ? "flag" : ""} title={t.flag}>
                <td className="mono">{t.date || "–"}</td>
                <td>{t.description}</td>
                <td className="num">{t.amount < 0 ? money(-t.amount) : ""}</td>
                <td className="num in">{t.amount > 0 ? money(t.amount) : ""}</td>
                <td className="num">{t.balance === null ? "" : money(t.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.transactions.length > 100 && !all && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setAll(true)}>
          Show all {r.transactions.length} transactions
        </button>
      )}
    </>
  );
}

function InvoicePreview({ r }: { r: InvoiceResult }) {
  if (!r.invoices.length) return <p className="small muted">No invoices or receipts were found in this PDF.</p>;
  return (
    <div className="col gap-16">
      {r.invoices.map((v, i) => (
        <div key={i} className="fx-invoice">
          <div className="fx-facts">
            <Fact k="Vendor" v={v.vendor || "–"} />
            <Fact k="Invoice #" v={v.invoiceNumber || "–"} />
            <Fact k="Date" v={v.invoiceDate || "–"} />
            {v.dueDate && <Fact k="Due" v={v.dueDate} />}
            {v.billTo && <Fact k="Bill to" v={v.billTo} />}
            {v.tax !== null && <Fact k="Tax" v={money(v.tax, v.currency)} />}
            <Fact k="Total" v={money(v.total, v.currency)} good />
          </div>
          {v.check.ok === false && <div className="notice small" style={{ marginBottom: 8 }}>{v.check.note}. Check the line items against the PDF.</div>}
          {v.lines.length > 0 && (
            <div className="fx-table-wrap">
              <table className="fx-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit price</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l, j) => (
                    <tr key={j}>
                      <td>{l.description}</td>
                      <td className="num">{l.quantity ?? ""}</td>
                      <td className="num">{l.unitPrice === null ? "" : money(l.unitPrice)}</td>
                      <td className="num">{l.amount === null ? "" : money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Fact({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="fx-fact">
      <span className="tiny faint">{k}</span>
      <b className={good ? "in" : ""}>{v}</b>
    </div>
  );
}

function PickModal({ docs, multiple, onPick, onClose }: { docs: Doc[]; multiple: boolean; onPick: (d: Doc[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <Modal
      title="Choose from your library"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!sel.length} onClick={() => onPick(docs.filter((d) => sel.includes(d.id)))}>
            Add {sel.length || ""} file{sel.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      {!multiple && <p className="small muted" style={{ marginTop: 0 }}>Free plan: one file at a time. <Link href="/pricing">Get a Day Pass or Pro</Link> to add many at once.</p>}
      <div className="col gap-4" style={{ maxHeight: 380, overflowY: "auto" }}>
        {docs.map((d) => {
          const on = sel.includes(d.id);
          return (
            <button
              key={d.id}
              className="menu-item"
              style={{ border: `1px solid ${on ? "var(--amber)" : "var(--line)"}`, background: on ? "var(--amber-soft)" : undefined }}
              onClick={() => setSel(multiple ? (on ? sel.filter((x) => x !== d.id) : [...sel, d.id]) : [d.id])}
            >
              {on ? <I.check size={14} /> : <I.file size={14} />}
              <span className="grow ellipsis">{d.name}</span>
              <span className="tiny faint mono">{d.pageCount} p</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
