"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { loadPdf, pageToCanvas } from "@/lib/client/pdf";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { ConvertToPdfModal } from "@/components/convert-to-pdf";

type ToolKey = "merge" | "split" | "extract" | "organize" | "delete_pages" | "rotate" | "watermark" | "page_numbers" | "optimize" | "metadata";

const TOOLS: { key: ToolKey | "topdf" | "images" | "scan" | "convert" | "ocr" | "compare"; title: string; desc: string; icon: React.ReactNode }[] = [
  { key: "topdf", title: "Convert to PDF", desc: "Word, Excel, PowerPoint, text and images to PDF.", icon: <I.file size={18} /> },
  { key: "convert", title: "Convert PDF", desc: "To Word, Excel, PowerPoint, JPG, PNG, WEBP, TIFF.", icon: <I.convert size={18} /> },
  { key: "merge", title: "Merge PDFs", desc: "Combine several documents into one, in any order.", icon: <I.merge size={18} /> },
  { key: "split", title: "Split PDF", desc: "Break a document into parts by page ranges.", icon: <I.split size={18} /> },
  { key: "organize", title: "Organize pages", desc: "Drag to reorder, rotate or delete pages visually.", icon: <I.layers size={18} /> },
  { key: "extract", title: "Extract pages", desc: "Copy selected pages into a new document.", icon: <I.file size={18} /> },
  { key: "delete_pages", title: "Delete pages", desc: "Remove pages and save a new version.", icon: <I.trash size={18} /> },
  { key: "rotate", title: "Rotate pages", desc: "Fix sideways scans by 90°, 180° or 270°.", icon: <I.rotate size={18} /> },
  { key: "watermark", title: "Watermark", desc: "Stamp DRAFT, CONFIDENTIAL or any text diagonally.", icon: <I.drop size={18} /> },
  { key: "page_numbers", title: "Page numbers", desc: "Add “Page n of N” or Bates-style numbering.", icon: <I.hash size={18} /> },
  { key: "optimize", title: "Optimize size", desc: "Re-pack the file structure to shrink bloated PDFs.", icon: <I.zoomOut size={18} /> },
  { key: "metadata", title: "Edit properties", desc: "Set title, author and subject metadata.", icon: <I.tag size={18} /> },
  { key: "images", title: "JPG/PNG → PDF", desc: "Combine images into a single PDF.", icon: <I.image size={18} /> },
  { key: "scan", title: "Scan to PDF", desc: "Use your camera with auto-crop and enhance.", icon: <I.camera size={18} /> },
  { key: "ocr", title: "OCR", desc: "Make scanned documents searchable in 13 languages.", icon: <I.scan size={18} /> },
  { key: "compare", title: "Compare", desc: "Redline two documents or versions, with an AI summary.", icon: <I.compare size={18} /> },
];

const NON_MODAL = ["topdf", "images", "scan", "convert", "ocr", "compare", "pick"];

/** Uploads files to the workspace library and hands back the created documents. */
function UploadButton({ wid, onDone, multiple = false, label = "Upload a PDF", accept = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.rtf,.txt,.jpg,.jpeg,.png" }: { wid: string; onDone: (d: Doc[]) => void; multiple?: boolean; label?: string; accept?: string }) {
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

const PICK_TASKS: Record<string, { title: string; hint: string }> = {
  edit: { title: "Edit a PDF", hint: "Pick the document to edit. You can change text, add images, highlight and redact." },
  sign: { title: "Request signatures", hint: "Pick the document people need to sign." },
  ask: { title: "Ask AI about a document", hint: "Pick a document and ask anything. Every answer cites its page." },
  read: { title: "Read aloud", hint: "Pick a document to listen to. Choose the voice, language and speed in the player." },
  ocr: { title: "Make a scan searchable", hint: "Pick a scanned PDF to run OCR on." },
  "convert-docx": { title: "PDF to Word", hint: "Pick or upload the PDF to convert to an editable Word document." },
  "convert-xlsx": { title: "PDF to Excel", hint: "Pick or upload the PDF to convert to an Excel workbook." },
  "convert-pptx": { title: "PDF to PowerPoint", hint: "Pick or upload the PDF to turn into slides." },
  "convert-jpg": { title: "PDF to JPG", hint: "Pick or upload the PDF to export as images." },
};

/** "Which document?" step for tasks that start from a single PDF (edit, sign, convert from PDF…). */
function PickDocModal({ wid, task, docs, onUploaded, onClose }: { wid: string; task: string; docs: Doc[]; onUploaded: (d: Doc[]) => void; onClose: () => void }) {
  const router = useRouter();
  const t = PICK_TASKS[task] ?? { title: "Choose a document", hint: "Pick a document from your library or upload one." };
  const go = (id: string) => router.push(task === "sign" ? `/app/${wid}/send/${id}` : `/app/${wid}?doc=${id}&do=${task}`);
  return (
    <Modal title={t.title} onClose={onClose}>
      <div className="col gap-12">
        <p className="small muted" style={{ margin: 0 }}>{t.hint}</p>
        <div className="row">
          <UploadButton
            wid={wid}
            label={docs.length ? "Upload a new file" : "Upload a file"}
            onDone={(d) => {
              onUploaded(d);
              go(d[0].id);
            }}
          />
        </div>
        {docs.length > 0 && (
          <>
            <div className="label">Or choose from your library</div>
            <div className="col gap-4" style={{ maxHeight: 340, overflowY: "auto" }}>
              {docs.map((d) => (
                <button key={d.id} className="menu-item" style={{ border: "1px solid var(--line)" }} onClick={() => go(d.id)}>
                  <I.file size={14} />
                  <span className="grow ellipsis">{d.name}</span>
                  <span className="tiny faint mono">{d.pageCount} p</span>
                  <I.right size={12} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Tools({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [docs, setDocs] = useState<Doc[]>([]);
  const initial = params.get("tool");
  const [open, setOpen] = useState<ToolKey | null>(() => (TOOLS.some((t) => t.key === initial) && !NON_MODAL.includes(initial!) ? (initial as ToolKey) : null));
  const preselect = params.get("doc");
  const [toPdf, setToPdf] = useState(initial === "topdf");
  const [pick, setPick] = useState<string | null>(initial === "pick" ? params.get("do") : null);
  const addDocs = (d: Doc[]) => setDocs((cur) => [...d, ...cur.filter((x) => !d.some((n) => n.id === x.id))]);

  useEffect(() => {
    api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`).then((r) => setDocs(r.documents));
  }, [wid]);

  const click = (k: (typeof TOOLS)[number]["key"]) => {
    if (k === "topdf") setToPdf(true);
    else if (k === "images" || k === "scan") router.push(`/app/${wid}?add=${k}`);
    else if (k === "convert" || k === "ocr") router.push(`/app/${wid}${preselect ? `?doc=${preselect}` : ""}`);
    else if (k === "compare") router.push(`/app/${wid}/compare${preselect ? `?a=${preselect}` : ""}`);
    else setOpen(k);
  };

  return (
    <AppShell wid={wid} title="PDF tools">
      <div className="shell">
        <h1>PDF tools</h1>
        <p className="muted">Every tool works on documents in your workspace. Changes to an existing document are saved as a new version, so nothing is ever lost.</p>
        <div className="tool-grid mt-24">
          {TOOLS.map((t) => (
            <button key={t.key} className="tool-card" onClick={() => click(t.key)}>
              <div className="ico">{t.icon}</div>
              <h3>{t.title}</h3>
              <p>{t.desc}</p>
            </button>
          ))}
        </div>
      </div>
      {pick && <PickDocModal wid={wid} task={pick} docs={docs} onUploaded={addDocs} onClose={() => setPick(null)} />}
      {toPdf && <ConvertToPdfModal wid={wid} onClose={() => setToPdf(false)} />}
      {open && <ToolModal wid={wid} tool={open} docs={docs} onUploaded={addDocs} preselect={preselect} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

function ToolModal({ wid, tool, docs, onUploaded, preselect, onClose }: { wid: string; tool: ToolKey; docs: Doc[]; onUploaded: (d: Doc[]) => void; preselect: string | null; onClose: () => void }) {
  const toast = useToast();
  const [docId, setDocId] = useState(preselect && docs.some((d) => d.id === preselect) ? preselect : (docs[0]?.id ?? ""));
  const [mergeIds, setMergeIds] = useState<string[]>([]);
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
  const doc = docs.find((d) => d.id === docId);
  const title = TOOLS.find((t) => t.key === tool)!.title;

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
          body = { op: "optimize", docId };
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
        {result.map((d) => (
          <div key={d.id} className="list-item">
            <I.file size={16} />
            <div className="grow">
              {d.name}
              <div className="tiny faint mono">{d.pageCount} pages</div>
            </div>
            <Link className="btn btn-sm" href={`/app/${wid}?doc=${d.id}`}>
              Open
            </Link>
            <a className="btn btn-sm btn-ghost" href={`/api/documents/${d.id}/file?download=1`}>
              <I.download size={12} />
            </a>
          </div>
        ))}
      </Modal>
    );
  }

  const docPicker = (
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
    busy || (tool === "merge" ? mergeIds.length < 2 || !name.trim() : !docId) || (tool === "organize" && organize.every((p) => p.deleted));

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={tool === "organize" || tool === "merge"}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={disabled} onClick={run}>
            {busy && <span className="spinner" />} {tool === "merge" ? `Merge ${mergeIds.length} documents` : "Apply"}
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
          {tool === "optimize" && <p className="small muted">Rewrites the PDF with compressed object streams and removes redundant structures. Visual content is unchanged.</p>}
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
