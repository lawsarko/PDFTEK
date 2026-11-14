"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { diffWordsWithSpace, type Change } from "diff";
import { api, errMsg } from "@/lib/client/api";
import type { Doc, Version, WorkspaceInfo } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { useToast } from "@/components/toast";
import { RichText } from "@/components/workbench/assistant";

type Side = { docId: string; versionId: string };
type Pages = { page: number; text: string }[];

export function Compare({ wid }: { wid: string }) {
  const params = useSearchParams();
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [versions, setVersions] = useState<Record<string, Version[]>>({});
  const [a, setA] = useState<Side>({ docId: params.get("a") ?? "", versionId: params.get("av") ?? "" });
  const [b, setB] = useState<Side>({ docId: params.get("b") ?? "", versionId: params.get("bv") ?? "" });
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [ai, setAi] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(false);

  useEffect(() => {
    api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`).then((r) => setDocs(r.documents));
    api<WorkspaceInfo>(`/api/workspaces/${wid}`).then((r) => setAi(r.capabilities.ai)).catch(() => {});
  }, [wid]);

  const loadVersions = async (docId: string) => {
    if (!docId || versions[docId]) return;
    const r = await api<{ versions: Version[] }>(`/api/documents/${docId}/versions`);
    setVersions((v) => ({ ...v, [docId]: r.versions }));
  };
  useEffect(() => {
    void loadVersions(a.docId);
    void loadVersions(b.docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.docId, b.docId]);

  const label = (s: Side) => {
    const d = docs.find((x) => x.id === s.docId);
    const v = versions[s.docId]?.find((x) => x.id === (s.versionId || d?.versionId));
    return `${d?.name ?? "?"}${v ? ` (v${v.version})` : ""}`;
  };

  const run = async () => {
    setBusy(true);
    setSummary(null);
    try {
      const get = (s: Side) => api<{ pages: Pages }>(`/api/documents/${s.docId}/text${s.versionId ? `?version=${s.versionId}` : ""}`);
      const [ta, tb] = await Promise.all([get(a), get(b)]);
      const flat = (p: Pages) => p.map((x) => `§§PAGE ${x.page}§§\n${x.text}`).join("\n\n");
      setChanges(diffWordsWithSpace(flat(ta.pages), flat(tb.pages)));
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    if (!changes) return null;
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    return {
      added: changes.filter((c) => c.added).reduce((n, c) => n + words(c.value), 0),
      removed: changes.filter((c) => c.removed).reduce((n, c) => n + words(c.value), 0),
      blocks: changes.filter((c) => c.added || c.removed).length,
    };
  }, [changes]);

  const summarize = async () => {
    if (!changes) return;
    setSummarizing(true);
    try {
      // Send only changed regions with a little context to keep the request focused.
      let out = "";
      let page = "1";
      changes.forEach((c, i) => {
        const m = [...c.value.matchAll(/§§PAGE (\d+)§§/g)].pop();
        if (c.added) out += ` {+${c.value.replace(/§§PAGE \d+§§/g, "")}+}`;
        else if (c.removed) out += ` [-${c.value.replace(/§§PAGE \d+§§/g, "")}-]`;
        else {
          const near = (changes[i + 1]?.added || changes[i + 1]?.removed) || (changes[i - 1]?.added || changes[i - 1]?.removed);
          if (near) {
            const clean = c.value.replace(/§§PAGE \d+§§/g, "");
            out += changes[i - 1]?.added || changes[i - 1]?.removed ? clean.slice(0, 160) : `\n\n[p.${m ? m[1] : page}] …${clean.slice(-160)}`;
          }
        }
        if (m) page = m[1];
      });
      const r = await api<{ summary: string }>("/api/compare", { method: "POST", json: { a: { documentId: a.docId, label: label(a) }, b: { documentId: b.docId, label: label(b) }, diff: out.slice(0, 380_000) } });
      setSummary(r.summary);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSummarizing(false);
    }
  };

  const picker = (side: Side, set: (s: Side) => void, title: string) => (
    <div className="card grow" style={{ minWidth: 260 }}>
      <div className="eyebrow">{title}</div>
      <select className="select mt-8" value={side.docId} onChange={(e) => set({ docId: e.target.value, versionId: "" })}>
        <option value="">Choose a document…</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {side.docId && (versions[side.docId]?.length ?? 0) > 1 && (
        <select className="select mt-8" value={side.versionId} onChange={(e) => set({ ...side, versionId: e.target.value })}>
          <option value="">Current version</option>
          {versions[side.docId].map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} — {v.note} ({new Date(v.createdAt).toLocaleDateString()})
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <AppShell wid={wid} title="Compare documents">
      <div className="shell">
        <h1>Compare</h1>
        <p className="muted">Redline any two documents, or two versions of the same one. Insertions are green, deletions are struck through in red.</p>
        <div className="row wrap gap-12 mt-16" style={{ alignItems: "stretch" }}>
          {picker(a, setA, "Original")}
          <div className="row" style={{ color: "var(--slate)" }}>
            <I.swap />
          </div>
          {picker(b, setB, "Revised")}
        </div>
        <div className="row mt-16">
          <button className="btn btn-primary" disabled={!a.docId || !b.docId || busy || (a.docId === b.docId && a.versionId === b.versionId)} onClick={run}>
            {busy && <span className="spinner" />} Compare
          </button>
          {changes && (
            <>
              <label className="check" style={{ marginLeft: 12 }}>
                <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Show changes only
              </label>
              <span className="grow" />
              <button className="btn" disabled={!ai || summarizing || !stats?.blocks} onClick={summarize} title={ai ? "" : "AI isn't configured on this server"}>
                {summarizing ? <span className="spinner" /> : <I.sparkle size={14} />} Summarize material changes
              </button>
            </>
          )}
        </div>
        {stats && (
          <div className="row gap-12 mt-16 small">
            <span className="badge badge-good">+{stats.added} words</span>
            <span className="badge badge-bad">−{stats.removed} words</span>
            <span className="muted">{stats.blocks} changed passages</span>
          </div>
        )}
        {summary && (
          <div className="card mt-16" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>AI summary of material changes</div>
            <RichText text={summary} />
          </div>
        )}
        {changes && (
          <div className="redline mt-16">
            {stats?.blocks === 0 && <p>No text differences found.</p>}
            {changes.map((c, i) => {
              const parts = c.value.split(/(§§PAGE \d+§§)/g);
              const render = parts.map((p, j) => {
                const m = p.match(/§§PAGE (\d+)§§/);
                if (m) return c.removed ? null : <span key={j} className="pg">Page {m[1]}</span>;
                return p;
              });
              if (c.added) return <ins key={i}>{render}</ins>;
              if (c.removed) return <del key={i}>{render}</del>;
              if (onlyChanges) {
                const near = changes[i - 1]?.added || changes[i - 1]?.removed || changes[i + 1]?.added || changes[i + 1]?.removed;
                const text = c.value.replace(/§§PAGE \d+§§/g, "");
                if (!near) return text.length > 0 ? <span key={i} className="pg">…</span> : null;
                return <span key={i}>{changes[i - 1]?.added || changes[i - 1]?.removed ? text.slice(0, 120) + (text.length > 120 ? " … " : "") : (text.length > 120 ? " … " : "") + text.slice(-120)}</span>;
              }
              return <span key={i}>{render}</span>;
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
