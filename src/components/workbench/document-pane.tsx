"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, bytes, download, errMsg, timeAgo } from "@/lib/client/api";
import type { Doc, Member, Version } from "@/lib/client/types";
import { forgetPdf, pageToCanvas } from "@/lib/client/pdf";
import { toDocx, toImages, toPptx, toText, toXlsx } from "@/lib/client/convert";
import { PdfViewer } from "../pdf-viewer";
import { I } from "../icons";
import { Menu, Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";
import { ReadAloud } from "./read-aloud";
import { Editor } from "./editor";

export function DocumentPane() {
  const { active, info, showUpload, flash, upsertDoc, requirePro, wid } = useWB();
  const toast = useToast();
  const [scale, setScale] = useState(1.25);
  const [page, setPage] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [tts, setTts] = useState(false);
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fitDone, setFitDone] = useState(false);

  const src = active ? `/api/documents/${active.id}/file?version=${active.versionId}` : "";

  // Fit width on first load.
  const onLoaded = useCallback(
    async (d: PDFDocumentProxy) => {
      setPdf(d);
      if (fitDone) return;
      const p = await d.getPage(1);
      const w = p.getViewport({ scale: 1 }).width;
      const avail = (scrollRef.current?.clientWidth ?? 800) - 48;
      setScale(Math.max(0.5, Math.min(1.6, avail / w)));
      setFitDone(true);
    },
    [fitDone],
  );

  if (!active) {
    return (
      <section className="viewer">
        <div className="empty" style={{ margin: "auto", maxWidth: 420 }}>
          <h3>Open a document</h3>
          <p>Pick a document from your library, or add new ones. pdftek reads PDFs, Office files, images and scans in any language.</p>
          <button className="btn btn-primary mt-12" onClick={showUpload}>
            <I.upload size={14} /> Upload documents
          </button>
        </div>
      </section>
    );
  }

  const me = info.me.id;
  const lockedByOther = active.checkedOutBy && active.checkedOutBy.id !== me;
  const lockedByMe = active.checkedOutBy?.id === me;

  const toggleLock = async () => {
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${active.id}/checkout`, { method: "POST", json: { action: lockedByMe ? "checkin" : "checkout" } });
      upsertDoc(r.document);
      toast(lockedByMe ? "Checked in — teammates can edit again" : "Checked out — you have the edit lock", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const convert = async (kind: string, pages?: number[]) => {
    setConvertOpen(false);
    if (!pdf) return;
    const label = `Converting to ${kind.toUpperCase()}`;
    const onProgress = (done: number, total: number) => setProgress({ label, done, total });
    setProgress({ label, done: 0, total: pdf.numPages });
    try {
      const b = active.name.replace(/\.pdf$/i, "");
      if (kind === "docx") {
        const blob = await api<Blob>(`/api/documents/${active.id}/convert?to=docx`).catch(() => null);
        if (blob) {
          download(blob, `${b}.docx`);
          toast("Conversion complete", "success");
          return;
        }
        download(await toDocx(pdf, active.name, onProgress), `${b}.docx`);
      } else if (kind === "xlsx") {
        const blob = await api<Blob>(`/api/documents/${active.id}/convert?to=xlsx`).catch(() => null);
        download(blob ?? (await toXlsx(pdf, onProgress)), `${b}.xlsx`);
      } else if (kind === "pptx") download(await toPptx(pdf, active.name, onProgress), `${b}.pptx`);
      else if (kind === "txt") download(await toText(pdf, onProgress), `${b}.txt`);
      else {
        const list = pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
        const r = await toImages(pdf, active.name, kind as "jpg", list, onProgress);
        download(r.blob, r.filename);
      }
      toast("Conversion complete", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setProgress(null);
    }
  };

  const print = async () => {
    const w = window.open(src, "_blank");
    w?.addEventListener("load", () => w.print());
  };

  if (editing) {
    return (
      <section className="viewer">
        <Editor
          doc={active}
          onExit={(saved) => {
            setEditing(false);
            if (saved) {
              forgetPdf(src);
              upsertDoc(saved);
            }
          }}
        />
      </section>
    );
  }

  return (
    <section className="viewer">
      <div className="viewer-toolbar">
        <div className="grow" style={{ minWidth: 160 }}>
          <div className="viewer-title ellipsis" title={active.name}>
            {active.name}
          </div>
          <div className="tiny mono faint row gap-4" style={{ marginTop: 2 }}>
            {active.pageCount} pages · {bytes(active.size)} · updated {timeAgo(active.updatedAt)}
            {active.assignedTo && <> · assigned to {active.assignedTo.id === me ? "you" : active.assignedTo.name}</>}
          </div>
        </div>
        <div className="viewer-tools">
          <a className="tool-btn tool-btn-primary" href={`/api/documents/${active.id}/file?download=1`} title="Download the latest version as PDF">
            <I.download size={13} /> Download
          </a>
          <div className="menu-wrap">
            <button className="tool-btn" onClick={() => setConvertOpen((v) => !v)} disabled={!pdf}>
              <I.convert size={13} /> Convert <I.chevron size={12} />
            </button>
            <Menu open={convertOpen} onClose={() => setConvertOpen(false)}>
              <div className="menu-label">Documents</div>
              <button className="menu-item" onClick={() => convert("docx")}>📝 Word (.docx)</button>
              <button className="menu-item" onClick={() => convert("xlsx")}>📊 Excel (.xlsx) <span className="sub">tables → cells</span></button>
              <button className="menu-item" onClick={() => convert("pptx")}>📽️ PowerPoint (.pptx)</button>
              <button className="menu-item" onClick={() => convert("txt")}>📄 Plain text (.txt)</button>
              <div className="menu-label">Images — all {active.pageCount} pages</div>
              <button className="menu-item" onClick={() => convert("jpg")}>🖼️ JPG</button>
              <button className="menu-item" onClick={() => convert("png")}>🖼️ PNG <span className="sub">transparent bg</span></button>
              <button className="menu-item" onClick={() => convert("webp")}>🖼️ WEBP <span className="sub">smaller files</span></button>
              <button className="menu-item" onClick={() => convert("tiff")}>🖼️ TIFF <span className="sub">print / archival</span></button>
              <div className="menu-label">This page only (p.{page})</div>
              <div className="row gap-4" style={{ padding: "2px 8px 8px" }}>
                {(["jpg", "png", "webp", "tiff"] as const).map((f) => (
                  <button key={f} className="chip" onClick={() => convert(f, [page])}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </Menu>
          </div>
          <Link href={`/app/${wid}/compare?a=${active.id}`} className="tool-btn">
            <I.compare size={13} /> Compare
          </Link>
          <button
            className="tool-btn"
            disabled={!!lockedByOther}
            onClick={() => {
              if (!requirePro("Text editing")) return;
              setEditing(true);
            }}
            title={lockedByOther ? `${active.checkedOutBy?.name} has the edit lock` : "Edit text, add images, highlight and redact"}
          >
            <I.edit size={13} /> Edit {info.workspace.plan === "free" && <span className="pro-tag">PRO</span>}
          </button>
          <button className={`tool-btn ${tts ? "active" : ""}`} onClick={() => setTts((v) => !v)}>
            <I.speaker size={13} /> Read aloud
          </button>
          <Link
            href={`/app/${wid}/send/${active.id}`}
            className="tool-btn"
            onClick={(e) => {
              if (!requirePro("E-signatures")) e.preventDefault();
            }}
          >
            <I.sign size={13} /> Request signature
          </Link>
          <button className="tool-btn" onClick={() => setHandoffOpen(true)} disabled={!!lockedByOther}>
            <I.swap size={13} /> Hand off
          </button>
          <button className={`tool-btn ${lockedByMe ? "active" : ""}`} onClick={toggleLock} disabled={!!lockedByOther && info.role === "member"}>
            {lockedByMe ? <I.unlock size={13} /> : <I.lock size={13} />} {lockedByMe ? "Check in" : "Check out"}
          </button>
          <div className="menu-wrap">
            <button className="tool-btn" onClick={() => setMoreOpen((v) => !v)} aria-label="More actions">
              <I.more size={13} />
            </button>
            <Menu open={moreOpen} onClose={() => setMoreOpen(false)}>
              <button className="menu-item" onClick={() => { setMoreOpen(false); setVersionsOpen(true); }}>
                <I.history size={14} /> Version history
              </button>
              <a className="menu-item" href={`/api/documents/${active.id}/file?download=1`}>
                <I.download size={14} /> Download PDF
              </a>
              <button className="menu-item" onClick={() => { setMoreOpen(false); void print(); }}>
                <I.file size={14} /> Print
              </button>
              <button className="menu-item" onClick={() => { setMoreOpen(false); setOcrOpen(true); }}>
                <I.scan size={14} /> Run OCR (make searchable)
              </button>
              <Link className="menu-item" href={`/app/${wid}/tools?doc=${active.id}`}>
                <I.tools size={14} /> Organize, split, watermark…
              </Link>
              {lockedByOther && info.role !== "member" && (
                <button
                  className="menu-item"
                  onClick={async () => {
                    setMoreOpen(false);
                    const r = await api<{ document: Doc }>(`/api/documents/${active.id}/checkout`, { method: "POST", json: { action: "force_checkin" } });
                    upsertDoc(r.document);
                    toast("Lock released");
                  }}
                >
                  <I.unlock size={14} /> Release {active.checkedOutBy?.name}’s lock
                </button>
              )}
            </Menu>
          </div>
        </div>
      </div>

      {lockedByOther && (
        <div className="notice" style={{ margin: "10px 16px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <I.lock size={14} /> {active.checkedOutBy?.name} has this document checked out {active.checkedOutAt ? timeAgo(active.checkedOutAt) : ""}. You can read, chat and extract; edits are paused until it’s checked in or handed to you.
        </div>
      )}
      {active.scanned && (
        <div className="notice notice-info" style={{ margin: "10px 16px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <I.scan size={14} /> This looks like a scan without a text layer. Run OCR so search and read-aloud can use its text (the AI assistant can already read it).
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOcrOpen(true)}>
            Run OCR
          </button>
        </div>
      )}
      {progress && (
        <div style={{ padding: "8px 16px" }}>
          <div className="row small muted between">
            <span>{progress.label}…</span>
            <span className="mono">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="progress mt-8">
            <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="page-scroll" ref={scrollRef}>
        <PdfViewer src={src} scale={scale} flash={flash} onLoaded={onLoaded} onVisiblePage={setPage} scrollRef={scrollRef} onError={(e) => toast(e.message, "error")} />
      </div>

      {!tts && (
        <div className="viewer-float">
          <button className="icon-btn" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.15).toFixed(2)))} aria-label="Zoom out">
            <I.zoomOut size={15} />
          </button>
          <span style={{ minWidth: 40, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button className="icon-btn" onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))} aria-label="Zoom in">
            <I.zoomIn size={15} />
          </button>
          <span style={{ width: 1, height: 16, background: "var(--line)" }} />
          <span>
            {page} / {active.pageCount}
          </span>
        </div>
      )}
      {tts && <ReadAloud doc={active} startPage={page} onClose={() => setTts(false)} />}
      {versionsOpen && <VersionsModal doc={active} onClose={() => setVersionsOpen(false)} />}
      {handoffOpen && <HandOffModal doc={active} onClose={() => setHandoffOpen(false)} />}
      {ocrOpen && pdf && <OcrModal doc={active} pdf={pdf} onClose={() => setOcrOpen(false)} />}
    </section>
  );
}

function VersionsModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { upsertDoc, wid } = useWB();
  const toast = useToast();
  const [versions, setVersions] = useState<Version[] | null>(null);
  useEffect(() => {
    api<{ versions: Version[] }>(`/api/documents/${doc.id}/versions`).then((r) => setVersions(r.versions)).catch((e) => toast(errMsg(e), "error"));
  }, [doc.id, toast]);
  const restore = async (v: Version) => {
    if (!confirm(`Restore version ${v.version}? This creates a new version with that content.`)) return;
    try {
      const r = await api<{ document: Doc; versions: Version[] }>(`/api/documents/${doc.id}/versions`, { method: "POST", json: { restore: v.id } });
      upsertDoc(r.document);
      setVersions(r.versions);
      toast(`Restored v${v.version}`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Modal title="Version history" onClose={onClose} wide>
      {!versions && <span className="spinner" />}
      {versions && (
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Change</th>
              <th>By</th>
              <th>When</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="mono">
                  v{v.version} {v.id === doc.versionId && <span className="badge badge-good">current</span>}
                </td>
                <td>{v.note}</td>
                <td>{v.createdBy}</td>
                <td className="small muted">{new Date(v.createdAt).toLocaleString()}</td>
                <td className="small muted mono">{bytes(v.size)}</td>
                <td>
                  <div className="row gap-4" style={{ justifyContent: "flex-end" }}>
                    <a className="btn btn-sm btn-ghost" href={`/api/documents/${doc.id}/file?version=${v.id}`} target="_blank" rel="noreferrer">
                      View
                    </a>
                    {v.id !== doc.versionId && (
                      <>
                        <Link className="btn btn-sm btn-ghost" href={`/app/${wid}/compare?a=${doc.id}&av=${v.id}&b=${doc.id}`}>
                          Compare
                        </Link>
                        <button className="btn btn-sm" onClick={() => restore(v)}>
                          Restore
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small faint mt-12">Each version is stored immutably with a SHA-256 fingerprint.</p>
    </Modal>
  );
}

function HandOffModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { wid, info, upsertDoc } = useWB();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ members: Member[] }>(`/api/workspaces/${wid}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [wid]);
  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${doc.id}/handoff`, { method: "POST", json: { userId: target, note } });
      upsertDoc(r.document);
      toast("Handed off", "success");
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Hand off document"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!target || busy} onClick={send}>Hand off</button>
        </>
      }
    >
      <div className="small muted" style={{ marginBottom: 10 }}>
        Currently assigned to <b style={{ color: "var(--text-hi)" }}>{doc.assignedTo ? (doc.assignedTo.id === info.me.id ? "you" : doc.assignedTo.name) : "nobody"}</b>.
        {doc.checkedOutBy?.id === info.me.id && " Your edit lock transfers with the hand-off."}
      </div>
      {members.map((m) => (
        <button key={m.id} className={`menu-item ${target === m.id ? "" : ""}`} style={target === m.id ? { background: "var(--amber-soft)" } : undefined} onClick={() => setTarget(m.id)}>
          <span className="avatar">{m.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>
          <span className="grow">
            {m.name} {m.id === info.me.id && <span className="faint">(you)</span>}
            <div className="sub">{m.email}</div>
          </span>
          {target === m.id && <I.check size={14} />}
        </button>
      ))}
      {members.length === 1 && (
        <div className="notice mt-12">
          You’re the only member. <Link href={`/app/${wid}/settings?tab=members`}>Invite teammates</Link> to hand documents off.
        </div>
      )}
      <div className="field mt-12">
        <label>Note (optional)</label>
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs doing next?" />
      </div>
    </Modal>
  );
}

const OCR_LANGS: [string, string][] = [
  ["eng", "English"],
  ["spa", "Spanish"],
  ["fra", "French"],
  ["deu", "German"],
  ["por", "Portuguese"],
  ["ita", "Italian"],
  ["nld", "Dutch"],
  ["chi_sim", "Chinese (Simplified)"],
  ["jpn", "Japanese"],
  ["kor", "Korean"],
  ["ara", "Arabic"],
  ["hin", "Hindi"],
  ["rus", "Russian"],
];

function OcrModal({ doc, pdf, onClose }: { doc: Doc; pdf: PDFDocumentProxy; onClose: () => void }) {
  const { upsertDoc } = useWB();
  const toast = useToast();
  const [langs, setLangs] = useState<string[]>(["eng"]);
  const [state, setState] = useState<{ page: number; pct: number } | null>(null);
  const cancelled = useRef(false);

  const run = async () => {
    cancelled.current = false;
    setState({ page: 1, pct: 0 });
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(langs.join("+"), 1, {
        logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && setState((s) => (s ? { ...s, pct: m.progress } : s)),
      });
      const pages: { page: number; text: string }[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (cancelled.current) break;
        setState({ page: p, pct: 0 });
        const canvas = await pageToCanvas(await pdf.getPage(p), 2);
        const { data } = await worker.recognize(canvas);
        pages.push({ page: p, text: data.text.trim() });
      }
      await worker.terminate();
      if (cancelled.current) return;
      await api(`/api/documents/${doc.id}/ocr`, { method: "POST", json: { pages } });
      upsertDoc({ ...doc, scanned: false });
      toast(`OCR complete — ${pages.length} pages are now searchable`, "success");
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
      setState(null);
    }
  };

  return (
    <Modal
      title="Run OCR"
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      footer={
        <button className="btn btn-primary" disabled={!!state || !langs.length} onClick={run}>
          {state ? <span className="spinner" /> : <I.scan size={14} />} {state ? "Recognizing…" : "Start OCR"}
        </button>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Text recognition runs privately in your browser, then pdftek indexes the text for search, read-aloud and conversions. Pick every language that appears in the document.
      </p>
      <div className="row wrap gap-4">
        {OCR_LANGS.map(([code, label]) => (
          <button key={code} className={`chip ${langs.includes(code) ? "active" : ""}`} onClick={() => setLangs((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]))}>
            {label}
          </button>
        ))}
      </div>
      {state && (
        <div className="mt-16">
          <div className="row between small muted">
            <span>
              Page {state.page} of {pdf.numPages}
            </span>
            <span className="mono">{Math.round(((state.page - 1 + state.pct) / pdf.numPages) * 100)}%</span>
          </div>
          <div className="progress mt-8">
            <div style={{ width: `${((state.page - 1 + state.pct) / pdf.numPages) * 100}%` }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
