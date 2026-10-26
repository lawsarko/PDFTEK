"use client";
import { useEffect, useState } from "react";
import { api, download, errMsg, timeAgo } from "@/lib/client/api";
import type { Extraction } from "@/lib/client/types";
import { I } from "../icons";
import { useToast } from "../toast";
import { useWB } from "./context";
import { AiUnavailable, RichText } from "./assistant";

const PRESETS: [string, string, string][] = [
  ["key_terms", "Key terms", "Parties, term, renewal, fees, caps, law"],
  ["dates", "Dates & deadlines", "Expiry, notice windows, payment dates"],
  ["risks", "Risk flags", "Checked against your team playbook"],
  ["obligations", "Obligations", "Who must do what, and when"],
  ["parties", "Parties", "Entities, roles, signatories"],
  ["financials", "Financial figures", "Amounts, currencies, frequencies"],
  ["tables", "Tables", "Every table, cell for cell"],
];

export function ExtractPanel() {
  const { active, info, jump } = useWB();
  const toast = useToast();
  const [items, setItems] = useState<Extraction[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!active) return;
    setItems(null);
    api<{ extractions: Extraction[] }>(`/api/documents/${active.id}/extract`)
      .then((r) => setItems(r.extractions))
      .catch(() => setItems([]));
  }, [active]);

  if (!active) return <div className="panel-body"><div className="empty">Open a document to extract structured data.</div></div>;

  const run = async (preset: string, fields?: string[]) => {
    setRunning(preset);
    try {
      const r = await api<{ extraction: Extraction }>(`/api/documents/${active.id}/extract`, { method: "POST", json: { preset, fields } });
      setItems((l) => [r.extraction, ...(l ?? [])]);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setRunning(null);
    }
  };

  const remove = async (id: string) => {
    await api(`/api/documents/${active.id}/extract?extractionId=${id}`, { method: "DELETE" }).catch(() => {});
    setItems((l) => l?.filter((x) => x.id !== id) ?? null);
  };

  const exportXlsx = async (ex: Extraction) => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    ex.result.tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t.columns, ...t.rows]), (t.title || `Table ${i + 1}`).slice(0, 31).replace(/[\\/?*[\]:]/g, " ")));
    if (!ex.result.tables.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Summary"], [ex.result.summary]]), "Summary");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    download(new Blob([out]), `${active.name.replace(/\.pdf$/i, "")} — ${ex.title}.xlsx`);
  };

  const exportCsv = (ex: Extraction) => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = ex.result.tables.map((t) => [t.title, t.columns.map(esc).join(","), ...t.rows.map((r) => r.map(esc).join(","))].join("\n")).join("\n\n");
    download(new Blob([csv], { type: "text/csv" }), `${active.name.replace(/\.pdf$/i, "")} — ${ex.title}.csv`);
  };

  return (
    <div className="panel-body">
      {!info.capabilities.ai && <AiUnavailable />}
      <div className="eyebrow">Extract from {active.name}</div>
      <div className="col gap-4">
        {PRESETS.map(([key, title, sub]) => (
          <button key={key} className="menu-item" style={{ border: "1px solid var(--line)" }} disabled={!!running || !info.capabilities.ai} onClick={() => run(key)}>
            <I.table size={14} />
            <span className="grow">
              {title}
              <div className="sub">{sub}</div>
            </span>
            {running === key ? <span className="spinner" /> : <I.right size={14} />}
          </button>
        ))}
      </div>
      <div className="card card-tight">
        <div className="label">Custom fields</div>
        <input className="input input-sm mt-8" placeholder="e.g. Governing law, Auto-renewal, Cap amount" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button
          className="btn btn-sm mt-8"
          disabled={!custom.trim() || !!running || !info.capabilities.ai}
          onClick={() => run("custom", custom.split(",").map((s) => s.trim()).filter(Boolean))}
        >
          {running === "custom" && <span className="spinner" />} Extract fields
        </button>
      </div>

      {items === null && <span className="spinner" />}
      {items?.map((ex) => (
        <div key={ex.id} className="card card-tight">
          <div className="row between">
            <b style={{ fontSize: 13.5 }}>{ex.title}</b>
            <span className="tiny faint mono">{timeAgo(ex.createdAt)}</span>
          </div>
          {ex.result.summary && (
            <div className="small muted mt-8" style={{ whiteSpace: "pre-wrap" }}>
              <RichText text={ex.result.summary} />
            </div>
          )}
          {ex.result.tables.map((t, ti) => {
            const pageCol = t.columns.findIndex((c) => /^page$/i.test(c));
            const sevCol = t.columns.findIndex((c) => /^severity$/i.test(c));
            return (
              <div key={ti} style={{ overflowX: "auto", marginTop: 10 }}>
                {ex.result.tables.length > 1 && <div className="label">{t.title}</div>}
                <table className="table">
                  <thead>
                    <tr>{t.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((cell, ci) => (
                          <td key={ci}>
                            {ci === pageCol && /^\d+/.test(cell) ? (
                              <button className="cite" onClick={() => jump(parseInt(cell, 10), r[ci === 0 ? 1 : 1])}>
                                p.{cell}
                              </button>
                            ) : ci === sevCol ? (
                              <span className={`badge ${/high/i.test(cell) ? "badge-bad" : /med/i.test(cell) ? "badge-warn" : "badge-muted"}`}>{cell}</span>
                            ) : (
                              cell
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <div className="row gap-4 mt-8">
            <button className="btn btn-sm btn-ghost" onClick={() => exportXlsx(ex)}>
              <I.download size={12} /> Excel
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => exportCsv(ex)}>
              <I.download size={12} /> CSV
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                const text = ex.result.tables.map((t) => [t.columns.join("\t"), ...t.rows.map((r) => r.join("\t"))].join("\n")).join("\n\n");
                navigator.clipboard.writeText(text).then(() => toast("Copied — paste into any spreadsheet"));
              }}
            >
              <I.copy size={12} /> Copy
            </button>
            <span className="grow" />
            <button className="icon-btn" onClick={() => remove(ex.id)} aria-label="Delete extraction">
              <I.trash size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
