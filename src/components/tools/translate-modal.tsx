"use client";
import { useMemo, useRef, useState } from "react";
import { download, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import type { Entitlements } from "@/lib/plans";
import { TRANSLATE_LANGUAGES, type TranslateLanguage } from "@/lib/translate-languages";
import { I } from "../icons";
import { Modal } from "../modal";
import { notifyPaywall, notifyUsage, PAYWALL_CODES } from "../paywall";

const POPULAR = ["es", "fr", "de", "pt", "zh-cn", "ar", "ja", "ko", "it", "ru", "nl", "tr"];
const LAST_KEY = "pdftek-translate-to";
const MAX_PAGES = 60;

type Stage = "reading" | "translating" | "drawing";
type Progress = { stage: Stage; done: number; total: number };

const STAGE_LABEL: Record<Stage, string> = {
  reading: "Reading the layout",
  translating: "Translating",
  drawing: "Building the translated PDF",
};

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** Translate PDF: pick a language, follow progress, open or download the translated copy. */
export function TranslateModal({
  doc,
  billing,
  onClose,
  onCreated,
}: {
  doc: Doc;
  billing?: Entitlements;
  onClose: () => void;
  /** The translated copy (saved to the library). */
  onCreated: (d: Doc) => void;
}) {
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<string | null>(() => {
    const last = remembered();
    return last && TRANSLATE_LANGUAGES.some((l) => l.code === last) ? last : null;
  });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ doc: Doc; credits: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = TRANSLATE_LANGUAGES;
    if (q) return all.filter((l) => `${l.english} ${l.native} ${l.code}`.toLowerCase().includes(q));
    const pop = POPULAR.map((c) => all.find((l) => l.code === c)!).filter(Boolean);
    return [...pop, ...all.filter((l) => !POPULAR.includes(l.code)).sort((a, b) => a.english.localeCompare(b.english))];
  }, [query]);

  const chosen = TRANSLATE_LANGUAGES.find((l) => l.code === lang) ?? null;
  const pages = doc.pageCount || 1;
  const balance = billing ? billing.credits + billing.allowance : null;
  const tooLong = pages > MAX_PAGES;
  const busy = Boolean(progress) && !result && !error;

  const start = async () => {
    if (!chosen) return;
    try {
      localStorage.setItem(LAST_KEY, chosen.code);
    } catch {}
    setError(null);
    setResult(null);
    setProgress({ stage: "reading", done: 0, total: pages });
    abort.current = new AbortController();
    try {
      const res = await fetch(`/api/documents/${doc.id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: chosen.code }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        const message = data?.error ?? "The translation couldn't start. Please try again.";
        if (res.status === 402 && data?.code && PAYWALL_CODES.has(data.code)) {
          notifyPaywall({ code: data.code, message });
          onClose();
          return;
        }
        throw new Error(message);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; stage?: Stage; done?: number; total?: number; document?: Doc; credits?: number; message?: string };
          if (ev.type === "progress" && ev.stage) setProgress({ stage: ev.stage, done: ev.done ?? 0, total: ev.total ?? 0 });
          else if (ev.type === "done" && ev.document) {
            setResult({ doc: ev.document, credits: ev.credits ?? 0 });
            onCreated(ev.document);
            notifyUsage();
          } else if (ev.type === "error") throw new Error(ev.message ?? "The translation couldn't be completed.");
        }
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(errMsg(e));
      setProgress(null);
    }
  };

  const save = async () => {
    if (!result) return;
    const res = await fetch(`/api/documents/${result.doc.id}/file?download=1`);
    if (res.ok) download(await res.blob(), result.doc.name);
  };

  const pct = progress ? (progress.stage === "reading" ? 6 : progress.stage === "translating" ? 10 + (progress.total ? (progress.done / progress.total) * 70 : 0) : 82 + (progress.total ? (progress.done / progress.total) * 18 : 0)) : 0;

  return (
    <Modal
      title="Translate PDF"
      onClose={() => {
        if (busy && !confirm("Stop following the translation? It keeps running and the translated copy is still saved to your library.")) return;
        abort.current?.abort();
        onClose();
      }}
      wide
      footer={
        result ? (
          <>
            <button className="btn" onClick={() => void save()}>
              <I.download size={14} /> Download
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              <I.file size={14} /> Open translated copy
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!chosen || busy || tooLong} onClick={() => void start()}>
              {busy ? <span className="spinner" /> : <I.globe size={14} />} {chosen ? `Translate to ${chosen.english}` : "Choose a language"}
            </button>
          </>
        )
      }
    >
      <div className="col gap-12">
        <div className="tool-doc">
          <I.file size={14} /> <span className="grow ellipsis">{doc.name}</span>
          <span className="tiny faint mono">{pages} p</span>
        </div>

        {result ? (
          <div className="tr-done">
            <span className="tr-done-ico">
              <I.check size={20} />
            </span>
            <div>
              <b>Translated copy ready</b>
              <div className="small muted">
                “{result.doc.name}” is in your library. The original is unchanged.
                {result.credits > 0 && ` Used ${result.credits} AI credit${result.credits === 1 ? "" : "s"}.`}
              </div>
            </div>
          </div>
        ) : progress ? (
          <div className="tr-progress" role="status" aria-live="polite">
            <div className="row between small">
              <b>
                {STAGE_LABEL[progress.stage]}
                {progress.stage === "translating" && progress.total > 0 && ` · ${progress.done} of ${progress.total} passages`}
                {progress.stage === "drawing" && progress.total > 0 && ` · page ${Math.min(progress.total, progress.done + 1)} of ${progress.total}`}
              </b>
              <span className="mono tiny faint">{Math.round(pct)}%</span>
            </div>
            <div className="progress mt-8">
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--amber)", transition: "width .4s" }} />
            </div>
            <p className="tiny faint mt-8" style={{ marginBottom: 0 }}>
              Into {chosen?.english}. Long documents can take a minute or two. You can close this window: the translated copy is saved to your library when it’s ready.
            </p>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="tr-search">Translate into</label>
              <div className="tr-search">
                <I.search size={14} />
                <input id="tr-search" className="input" placeholder="Search languages" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
              </div>
            </div>
            <div className="tr-langs" role="listbox" aria-label="Languages">
              {list.map((l: TranslateLanguage) => (
                <button key={l.code} role="option" aria-selected={lang === l.code} className={`tr-lang ${lang === l.code ? "on" : ""}`} onClick={() => setLang(l.code)}>
                  <span className="tr-lang-native" lang={l.code} dir={l.rtl ? "rtl" : undefined}>
                    {l.native}
                  </span>
                  {l.native !== l.english && <span className="tr-lang-en">{l.english}</span>}
                </button>
              ))}
              {list.length === 0 && <div className="small muted" style={{ padding: 8 }}>No language matches “{query}”.</div>}
            </div>
            {error && <div className="notice notice-bad">{error}</div>}
            {tooLong ? (
              <div className="notice">
                This document has {pages} pages. Translate PDF handles up to {MAX_PAGES} pages at a time: split it first (Organize → Split).
              </div>
            ) : (
              <div className="tr-facts">
                <span>
                  <I.layers size={13} /> Keeps the layout: fonts, colours, tables and images stay where they are.
                </span>
                <span>
                  <I.copy size={13} /> Saved as a new document. The original isn’t changed.
                </span>
                <span>
                  <I.sparkle size={13} /> Uses AI credits: about {pages * 2}–{pages * 4} for this document
                  {balance !== null && billing?.tier !== "admin" && <> · balance {balance.toLocaleString()}</>}.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
