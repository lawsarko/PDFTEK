"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, download, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { loadPdf, pageToCanvas } from "@/lib/client/pdf";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";

/**
 * The page tools (merge, split, rotate, watermark, compress, protect…) as dialogs, shared by the
 * Tools page and the workbench. From the workbench they run on the open document directly.
 */

export type ToolKey = "merge" | "split" | "extract" | "organize" | "delete_pages" | "rotate" | "watermark" | "page_numbers" | "optimize" | "metadata" | "protect";

export const TOOL_TITLES: Record<ToolKey, string> = {
  merge: "Merge PDFs",
  split: "Split PDF",
  organize: "Organize pages",
  extract: "Extract pages",
  delete_pages: "Delete pages",
  rotate: "Rotate pages",
  watermark: "Watermark",
  page_numbers: "Page numbers",
  optimize: "Compress PDF",
  protect: "Protect PDF",
  metadata: "Edit properties",
};

/** Uploads files to the workspace library and hands back the created documents. */
export function UploadButton({ wid, onDone, multiple = false, label = "Upload a PDF", accept = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.rtf,.txt,.jpg,.jpeg,.png,.tif,.tiff" }: { wid: string; onDone: (d: Doc[]) => void; multiple?: boolean; label?: string; accept?: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const r = await api<{ documents: Doc[]; errors: { name: string; error: string }[] }>(`/api/workspaces/${wid}/documents`, { method: "POST", body: form });
      r.errors.forEach((e) => toast(`${e.name}: ${e.error}`, "error"));
      if (r.documents.length) onDone(r.documents);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : <I.upload size={13} />} {busy ? "Uploading…" : label}
      </button>
      <input ref={input} type="file" hidden multiple={multiple} accept={accept} onChange={(e) => void upload(e.target.files)} />
    </>
  );
}


/** Remove a PDF's password: upload the locked file, enter its password, get an unlocked copy. */
export function UnlockModal({ wid, onUploaded, onClose }: { wid: string; onUploaded: (d: Doc[]) => void; onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Doc | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("password", password);
      const r = await api<{ document: Doc }>(`/api/workspaces/${wid}/unlock`, { method: "POST", body: form });
      onUploaded([r.document]);
      setDone(r.document);
      toast("Password removed", "success");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal title="Unlock PDF — done" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
        <div className="list-item">
          <I.unlock size={16} />
          <div className="grow">
            {done.name}
            <div className="tiny faint mono">{done.pageCount} pages · no password</div>
          </div>
          <Link className="btn btn-sm" href={`/app/${wid}?doc=${done.id}`}>Open</Link>
          <a className="btn btn-sm btn-primary" href={`/api/documents/${done.id}/file?download=1`}>
            <I.download size={12} /> PDF
          </a>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Unlock PDF"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!file || busy} onClick={run}>
            {busy && <span className="spinner" />} Remove password
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="dropzone" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] ?? null); setError(null); }}>
          <I.lock size={24} />
          <div style={{ marginTop: 8, fontWeight: 500 }}>{file ? file.name : <>Drop a password-protected PDF, or <span style={{ color: "var(--amber)" }}>browse</span></>}</div>
          <input ref={input} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
        </div>
        <div className="field">
          <label>Password</label>
          <div className="row">
            <input className="input grow" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} placeholder="The password used to open the PDF" />
            <button className="btn btn-sm btn-ghost" onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
          </div>
          <span className="tiny faint">Leave empty if the PDF opens without a password but blocks printing or copying.</span>
        </div>
        {error && <div className="notice notice-bad">{error}</div>}
        <p className="tiny faint" style={{ margin: 0 }}>Only remove passwords from documents you own or have permission to unlock.</p>
      </div>
    </Modal>
  );
}


export function ToolModal({
  wid,
  tool,
  docs,
  onUploaded,
  preselect,
  onClose,
  fixedDoc = false,
  onOpen,
}: {
  wid: string;
  tool: ToolKey;
  docs: Doc[];
  onUploaded: (d: Doc[]) => void;
  preselect: string | null;
  onClose: () => void;
  /** Opened from the workbench: work on `preselect` without offering other documents or uploads. */
  fixedDoc?: boolean;
  /** Opens a result in place (the workbench) instead of navigating. */
  onOpen?: (id: string) => void;
}) {
  const toast = useToast();
  const [docId, setDocId] = useState(preselect && docs.some((d) => d.id === preselect) ? preselect : (docs[0]?.id ?? ""));
  const [mergeIds, setMergeIds] = useState<string[]>(preselect ? [preselect] : []);
  const [name, setName] = useState("Merged document");
  const [ranges, setRanges] = useState("1");
  const [parts, setParts] = useState("1-2, 3-");
  const [deg, setDeg] = useState<90 | 180 | 270>(90);
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.15);
  const [asCopy, setAsCopy] = useState(true);
  const [position, setPosition] = useState<"bottom-center" | "bottom-right" | "top-right">("bottom-center");
  const [format, setFormat] = useState("Page {n} of {total}");
  const [start, setStart] = useState(1);
  const [meta, setMeta] = useState({ title: "", author: "", subject: "" });
  const [organize, setOrganize] = useState<{ index: number; rotate: number; deleted: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Doc[] | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [level, setLevel] = useState<"light" | "recommended" | "strong">("recommended");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [perms, setPerms] = useState({ printing: true, copying: true, modifying: false });
  const doc = docs.find((d) => d.id === docId);
  const title = TOOL_TITLES[tool];

  // The document list can arrive after the modal opens; pick a default once it does.
  useEffect(() => {
    if (!docId && docs.length) setDocId(preselect && docs.some((d) => d.id === preselect) ? preselect : docs[0].id);
  }, [docs, docId, preselect]);

  useEffect(() => {
    if (tool === "metadata" && doc) setMeta({ title: doc.name.replace(/\.pdf$/i, ""), author: "", subject: "" });
    if (tool === "organize" && doc) setOrganize(Array.from({ length: doc.pageCount }, (_, i) => ({ index: i, rotate: 0, deleted: false })));
  }, [tool, doc]);

  const run = async () => {
    setBusy(true);
    try {
      if (tool === "protect") {
        const blob = await api<Blob>(`/api/documents/${docId}/protect`, { method: "POST", json: { password: pw, ...perms } });
        download(blob, `${(doc?.name ?? "document").replace(/\.pdf$/i, "")} (protected).pdf`);
        toast("Protected copy downloaded. Keep the password safe: it can't be recovered.", "success");
        onClose();
        return;
      }
      let body: Record<string, unknown>;
      switch (tool) {
        case "merge":
          body = { op: "merge", docIds: mergeIds, name };
          break;
        case "split":
          body = { op: "split", docId, ranges: parts.split(",").map((s) => s.trim()).filter(Boolean).map((r) => (r.endsWith("-") ? `${r}${doc?.pageCount}` : r)) };
          break;
        case "extract":
          body = { op: "extract", docId, ranges };
          break;
        case "delete_pages":
          body = { op: "delete_pages", docId, ranges };
          break;
        case "rotate":
          body = { op: "rotate", docId, ranges, degrees: deg };
          break;
        case "watermark":
          body = { op: "watermark", docId, text, opacity, asCopy };
          break;
        case "page_numbers":
          body = { op: "page_numbers", docId, position, format, start };
          break;
        case "optimize":
          body = { op: "optimize", docId, level };
          break;
        case "metadata":
          body = { op: "metadata", docId, ...meta };
          break;
        case "organize":
          body = { op: "organize", docId, pages: organize.filter((p) => !p.deleted).map((p) => ({ index: p.index, rotate: p.rotate })) };
          break;
      }
      const r = await api<{ documents: Doc[]; message?: string }>(`/api/workspaces/${wid}/tools`, { method: "POST", json: body });
      setResult(r.documents);
      setResultNote(r.message ?? null);
      onUploaded(r.documents);
      toast(r.message ?? "Done", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title={`${title} — done`} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
        {resultNote && <div className={`notice ${tool === "optimize" ? "notice-info" : ""}`} style={{ marginBottom: 12 }}>{resultNote}</div>}
        {result.map((d) => (
          <div key={d.id} className="list-item">
            <I.file size={16} />
            <div className="grow">
              {d.name}
              <div className="tiny faint mono">{d.pageCount} pages</div>
            </div>
            {onOpen ? (
              <button className="btn btn-sm" onClick={() => { onOpen(d.id); onClose(); }}>
                Open
              </button>
            ) : (
              <Link className="btn btn-sm" href={`/app/${wid}?doc=${d.id}`}>
                Open
              </Link>
            )}
            <a className="btn btn-sm btn-ghost" href={`/api/documents/${d.id}/file?download=1`}>
              <I.download size={12} />
            </a>
          </div>
        ))}
      </Modal>
    );
  }

  const docPicker = fixedDoc && doc ? (
    <div className="tool-doc">
      <I.file size={14} /> <span className="grow ellipsis">{doc.name}</span> <span className="tiny faint mono">{doc.pageCount} p</span>
    </div>
  ) : (
    <div className="field">
      <div className="row between">
        <label>Document</label>
        <UploadButton wid={wid} label="Upload" onDone={(d) => { onUploaded(d); setDocId(d[0].id); }} />
      </div>
      <select className="select" value={docId} onChange={(e) => setDocId(e.target.value)}>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.pageCount} p)
          </option>
        ))}
      </select>
    </div>
  );

  const disabled =
    busy ||
    (tool === "merge" ? mergeIds.length < 2 || !name.trim() : !docId) ||
    (tool === "organize" && organize.every((p) => p.deleted)) ||
    (tool === "protect" && (pw.length < 4 || pw !== pw2));

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={tool === "organize" || tool === "merge"}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={disabled} onClick={run}>
            {busy && <span className="spinner" />} {tool === "merge" ? `Merge ${mergeIds.length} documents` : tool === "protect" ? "Protect & download" : tool === "optimize" ? "Compress" : "Apply"}
          </button>
        </>
      }
    >
      {docs.length === 0 && (
        <div className="empty" style={{ padding: 24 }}>
          <p className="small muted">Upload {tool === "merge" ? "the PDFs you want to combine" : "a PDF"} to get started.</p>
          <UploadButton
            wid={wid}
            multiple={tool === "merge"}
            label={tool === "merge" ? "Upload PDFs" : "Upload a PDF"}
            onDone={(d) => {
              onUploaded(d);
              if (tool === "merge") setMergeIds(d.map((x) => x.id));
              else setDocId(d[0].id);
            }}
          />
        </div>
      )}
      {tool === "merge" && docs.length > 0 && (
        <div className="col gap-12">
          <div className="field">
            <label>New document name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="row between">
            <div className="label">Select documents in the order they should appear</div>
            <UploadButton wid={wid} multiple label="Upload more" onDone={(d) => { onUploaded(d); setMergeIds((m) => [...m, ...d.map((x) => x.id)]); }} />
          </div>
          <div className="col gap-4" style={{ maxHeight: 360, overflowY: "auto" }}>
            {docs.map((d) => {
              const idx = mergeIds.indexOf(d.id);
              return (
                <button key={d.id} className="menu-item" style={{ border: "1px solid var(--line)", background: idx >= 0 ? "var(--amber-soft)" : undefined }} onClick={() => setMergeIds(idx >= 0 ? mergeIds.filter((x) => x !== d.id) : [...mergeIds, d.id])}>
                  <span className="avatar" style={idx >= 0 ? { background: "var(--amber)", color: "#1a1206" } : undefined}>
                    {idx >= 0 ? idx + 1 : ""}
                  </span>
                  <span className="grow ellipsis">{d.name}</span>
                  <span className="tiny faint mono">{d.pageCount} p</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {tool !== "merge" && docs.length > 0 && (
        <div className="col gap-12">
          {docPicker}
          {(tool === "extract" || tool === "delete_pages" || tool === "rotate") && (
            <div className="field">
              <label>Pages (e.g. 1-3, 5, 8-)</label>
              <input className="input" value={ranges} onChange={(e) => setRanges(e.target.value)} />
            </div>
          )}
          {tool === "rotate" && (
            <div className="row gap-4">
              {([90, 180, 270] as const).map((d) => (
                <button key={d} className={`chip ${deg === d ? "active" : ""}`} onClick={() => setDeg(d)}>
                  {d === 90 ? "↻ 90° right" : d === 180 ? "180°" : "↺ 90° left"}
                </button>
              ))}
            </div>
          )}
          {tool === "split" && (
            <div className="field">
              <label>Parts — comma-separated ranges; each becomes a new document</label>
              <input className="input" value={parts} onChange={(e) => setParts(e.target.value)} />
              <span className="tiny faint">“3-” means page 3 to the end. This document has {doc?.pageCount} pages.</span>
            </div>
          )}
          {tool === "watermark" && (
            <>
              <div className="field">
                <label>Text</label>
                <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div className="row gap-4">
                {["CONFIDENTIAL", "DRAFT", "COPY", "PRIVILEGED"].map((t) => (
                  <button key={t} className="chip" onClick={() => setText(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="field">
                <label>Opacity: {Math.round(opacity * 100)}%</label>
                <input type="range" min={0.05} max={0.6} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
              </div>
              <label className="check">
                <input type="checkbox" checked={asCopy} onChange={(e) => setAsCopy(e.target.checked)} /> Save as a new document (keep the original clean)
              </label>
            </>
          )}
          {tool === "page_numbers" && (
            <>
              <div className="row gap-4 wrap">
                {(["bottom-center", "bottom-right", "top-right"] as const).map((p) => (
                  <button key={p} className={`chip ${position === p ? "active" : ""}`} onClick={() => setPosition(p)}>
                    {p.replace("-", " ")}
                  </button>
                ))}
              </div>
              <div className="row gap-12 wrap">
                <div className="field grow">
                  <label>Format — use {"{n}"}, {"{n:6}"} (zero-padded) and {"{total}"}</label>
                  <input className="input" value={format} onChange={(e) => setFormat(e.target.value)} />
                </div>
                <div className="field">
                  <label>Start at</label>
                  <input className="input" type="number" style={{ width: 100 }} value={start} onChange={(e) => setStart(Number(e.target.value) || 1)} />
                </div>
              </div>
              <div className="row gap-4">
                <button className="chip" onClick={() => setFormat("Page {n} of {total}")}>Page n of N</button>
                <button className="chip" onClick={() => setFormat("{n}")}>n</button>
                <button className="chip" onClick={() => { setFormat("ACME{n:6}"); setStart(1); }}>Bates (ACME000001)</button>
              </div>
            </>
          )}
          {tool === "metadata" && (
            <>
              <div className="field"><label>Title</label><input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></div>
              <div className="field"><label>Author</label><input className="input" value={meta.author} onChange={(e) => setMeta({ ...meta, author: e.target.value })} /></div>
              <div className="field"><label>Subject</label><input className="input" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} /></div>
            </>
          )}
          {tool === "optimize" && (
            <>
              <div className="label">Compression level{doc ? ` · current size ${(doc.size / 1024 / 1024).toFixed(doc.size < 1024 * 1024 ? 2 : 1)} MB` : ""}</div>
              <div className="col gap-4">
                {(
                  [
                    ["light", "Light", "Best quality: keeps images sharp for printing"],
                    ["recommended", "Recommended", "Good quality, much smaller: right for email and sharing"],
                    ["strong", "Strong", "Smallest file: images get softer"],
                  ] as const
                ).map(([k, label, sub]) => (
                  <button key={k} className="menu-item" style={{ border: `1px solid ${level === k ? "var(--amber)" : "var(--line)"}`, background: level === k ? "var(--amber-soft)" : undefined }} onClick={() => setLevel(k)}>
                    <span className="grow">
                      <b style={{ fontWeight: 600 }}>{label}</b>
                      <div className="tiny muted">{sub}</div>
                    </span>
                    {level === k && <I.check size={14} />}
                  </button>
                ))}
              </div>
              <p className="tiny faint" style={{ margin: 0 }}>Text stays sharp and searchable. The compressed file is saved as a new version, so you can always restore the original.</p>
            </>
          )}
          {tool === "protect" && (
            <>
              <div className="field">
                <label>Password</label>
                <div className="row">
                  <input className="input grow" type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 4 characters" />
                  <button className="btn btn-sm btn-ghost" onClick={() => setShowPw((v) => !v)}>{showPw ? "Hide" : "Show"}</button>
                </div>
              </div>
              <div className="field">
                <label>Confirm password</label>
                <input className="input" type={showPw ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
                {pw2 && pw !== pw2 && <span className="tiny" style={{ color: "var(--bad)" }}>Passwords don&apos;t match.</span>}
              </div>
              <div className="label">After opening, people can:</div>
              <label className="check"><input type="checkbox" checked={perms.printing} onChange={(e) => setPerms({ ...perms, printing: e.target.checked })} /> Print</label>
              <label className="check"><input type="checkbox" checked={perms.copying} onChange={(e) => setPerms({ ...perms, copying: e.target.checked })} /> Copy text and images</label>
              <label className="check"><input type="checkbox" checked={perms.modifying} onChange={(e) => setPerms({ ...perms, modifying: e.target.checked })} /> Edit, comment and rearrange pages</label>
              <p className="tiny faint" style={{ margin: 0 }}>You&apos;ll download an AES-256 encrypted copy. The copy in your library stays unlocked so your team can keep working with it.</p>
            </>
          )}
          {tool === "organize" && doc && <Organizer docId={doc.id} versionId={doc.versionId} pages={organize} setPages={setOrganize} />}
        </div>
      )}
    </Modal>
  );
}

function Organizer({ docId, versionId, pages, setPages }: { docId: string; versionId: string | null; pages: { index: number; rotate: number; deleted: boolean }[]; setPages: (p: { index: number; rotate: number; deleted: boolean }[]) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  useEffect(() => {
    loadPdf(`/api/documents/${docId}/file?version=${versionId}`).then(setPdf);
  }, [docId, versionId]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
        const page = await pdf.getPage(i);
        const s = 150 / page.getViewport({ scale: 1 }).width;
        const c = await pageToCanvas(page, s);
        if (!cancelled) setThumbs((t) => ({ ...t, [i - 1]: c.toDataURL("image/jpeg", 0.7) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const move = (from: number, to: number) => {
    const copy = [...pages];
    const [m] = copy.splice(from, 1);
    copy.splice(to, 0, m);
    setPages(copy);
  };

  return (
    <>
      <div className="small muted">Drag to reorder · hover a page to rotate or delete · {pages.filter((p) => !p.deleted).length} of {pages.length} pages kept</div>
      <div className="thumbs" style={{ maxHeight: "55vh", overflowY: "auto", padding: 4 }}>
        {pages.map((p, i) => (
          <div
            key={p.index}
            className={`thumb ${drag === i ? "dragging" : ""} ${over === i && drag !== i ? "drop-target" : ""} ${p.deleted ? "deleted" : ""}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDrop={() => {
              if (drag !== null) move(drag, i);
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            {thumbs[p.index] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[p.index]} alt={`Page ${p.index + 1}`} style={{ transform: `rotate(${p.rotate}deg)`, maxHeight: 150, transition: "transform .2s" }} />
            ) : (
              <div style={{ height: 150, display: "flex", alignItems: "center" }}>
                <span className="spinner" />
              </div>
            )}
            <span className="tiny mono faint">p.{p.index + 1}</span>
            <div className="thumb-actions">
              <button className="icon-btn" style={{ background: "var(--panel)" }} onClick={() => setPages(pages.map((x, j) => (j === i ? { ...x, rotate: (x.rotate + 90) % 360 } : x)))} aria-label="Rotate">
                <I.rotate size={12} />
              </button>
              <button className="icon-btn" style={{ background: "var(--panel)" }} onClick={() => setPages(pages.map((x, j) => (j === i ? { ...x, deleted: !x.deleted } : x)))} aria-label={p.deleted ? "Restore" : "Delete"}>
                {p.deleted ? <I.undo size={12} /> : <I.trash size={12} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
