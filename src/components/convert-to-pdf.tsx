"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { toJpeg } from "@/lib/client/images";
import { I } from "./icons";
import { Modal } from "./modal";
import { useToast } from "./toast";

const OFFICE_RE = /\.(docx?|odt|rtf|pptx?|odp|xlsx?|ods|html?)$/i;
const BROWSER_IMAGE_RE = /\.(webp|heic|gif|bmp|tiff?)$/i;
const ACCEPT = ".doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.xls,.xlsx,.ods,.html,.htm,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,.heic,.gif,.bmp,.tif,.tiff";

type Item = { file: File; status: "queued" | "converting" | "done" | "error"; doc?: Doc; error?: string };

function kindOf(name: string) {
  if (/\.(docx?|odt|rtf)$/i.test(name)) return "Word";
  if (/\.(xlsx?|ods|csv)$/i.test(name)) return "Excel";
  if (/\.(pptx?|odp)$/i.test(name)) return "PowerPoint";
  if (/\.html?$/i.test(name)) return "Web page";
  if (/\.(txt|md)$/i.test(name)) return "Text";
  return "Image";
}

function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Converts Word, Excel, PowerPoint, text and image files to PDF; results are saved to the library. */
export function ConvertToPdfModal({ wid, onClose }: { wid: string; onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState(false);
  const [merged, setMerged] = useState<Doc | null>(null);
  const [office, setOffice] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ capabilities: { serverOffice: boolean } }>(`/api/workspaces/${wid}`)
      .then((r) => setOffice(r.capabilities.serverOffice))
      .catch(() => setOffice(null));
  }, [wid]);

  const add = (files: Iterable<File>) => {
    const list = [...files].filter((f) => !/\.pdf$/i.test(f.name));
    setItems((cur) => [...cur.filter((i) => i.status !== "done"), ...list.map((file) => ({ file, status: "queued" as const }))].slice(0, 20));
    setMerged(null);
  };

  const patch = (i: number, p: Partial<Item>) => setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...p } : it)));

  const convert = async () => {
    setBusy(true);
    setMerged(null);
    const done: Doc[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.status === "done") {
        if (it.doc) done.push(it.doc);
        continue;
      }
      patch(i, { status: "converting", error: undefined });
      try {
        let f = it.file;
        if (BROWSER_IMAGE_RE.test(f.name)) {
          const j = await toJpeg(f);
          f = new File([j.bytes as BlobPart], f.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
        }
        const form = new FormData();
        form.append("files", f);
        const r = await api<{ documents: Doc[]; errors: { error: string }[] }>(`/api/workspaces/${wid}/documents`, { method: "POST", body: form });
        if (!r.documents[0]) throw new Error(r.errors[0]?.error ?? "Conversion failed.");
        patch(i, { status: "done", doc: r.documents[0] });
        done.push(r.documents[0]);
      } catch (e) {
        patch(i, { status: "error", error: errMsg(e) });
      }
    }
    try {
      if (merge && done.length > 1) {
        const name = done[0].name.replace(/\.pdf$/i, "") + " (combined)";
        const r = await api<{ documents: Doc[] }>(`/api/workspaces/${wid}/tools`, { method: "POST", json: { op: "merge", docIds: done.map((d) => d.id), name } });
        setMerged(r.documents[0]);
        download(`/api/documents/${r.documents[0].id}/file?download=1`);
      } else if (done.length === 1) {
        download(`/api/documents/${done[0].id}/file?download=1`);
      }
      if (done.length) toast(`Converted ${done.length} file${done.length > 1 ? "s" : ""} to PDF`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const pending = items.filter((i) => i.status !== "done").length;
  const officeBlocked = office === false && items.some((i) => i.status !== "done" && OFFICE_RE.test(i.file.name));

  return (
    <Modal
      title="Convert to PDF"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={busy || !pending} onClick={convert}>
            {busy ? <span className="spinner" /> : <I.convert size={14} />} {busy ? "Converting…" : `Convert ${pending || ""} to PDF`}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer.files);
          }}
        >
          <I.upload size={26} />
          <div style={{ marginTop: 8, fontWeight: 500 }}>
            Drop Word, Excel, PowerPoint or image files, or <span style={{ color: "var(--amber)" }}>browse</span>
          </div>
          <div className="small muted mt-8">DOCX, DOC, XLSX, XLS, PPTX, PPT, ODT, RTF, HTML, TXT, CSV, JPG, PNG, WEBP, HEIC, TIFF · up to 20 files</div>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              add(e.target.files ?? []);
              e.target.value = "";
            }}
          />
        </div>

        {officeBlocked && (
          <div className="card card-tight small" style={{ borderColor: "var(--amber)" }}>
            Word, Excel and PowerPoint conversion needs LibreOffice on the server, and this server doesn’t have it. Deploy with the
            included Dockerfile (on Render: the <span className="mono">render.yaml</span> blueprint) to enable it. Images and text files still work.
          </div>
        )}

        {items.length > 0 && (
          <div className="card card-tight">
            {items.map((it, i) => (
              <div key={i} className="row small" style={{ padding: "5px 0" }}>
                <I.file size={14} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{it.file.name}</div>
                  <div className="tiny faint mono">
                    {kindOf(it.file.name)} · {it.file.size < 1024 * 1024 ? `${Math.max(1, Math.round(it.file.size / 1024))} KB` : `${(it.file.size / 1024 / 1024).toFixed(1)} MB`}
                    {it.status === "done" && it.doc && <> → {it.doc.pageCount} page PDF</>}
                  </div>
                  {it.error && <div className="tiny" style={{ color: "var(--red, #e5484d)" }}>{it.error}</div>}
                </div>
                {it.status === "converting" && <span className="spinner" />}
                {it.status === "done" && it.doc && (
                  <>
                    <Link className="btn btn-sm" href={`/app/${wid}?doc=${it.doc.id}`}>Open</Link>
                    <a className="btn btn-sm btn-primary" href={`/api/documents/${it.doc.id}/file?download=1`}>
                      <I.download size={12} /> PDF
                    </a>
                  </>
                )}
                {it.status !== "done" && it.status !== "converting" && (
                  <button className="icon-btn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove">
                    <I.x size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length > 1 && (
          <label className="row small">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> Also combine everything into one PDF
          </label>
        )}

        {merged && (
          <div className="row small card card-tight">
            <I.merge size={14} />
            <span className="grow ellipsis">{merged.name}</span>
            <a className="btn btn-sm btn-primary" href={`/api/documents/${merged.id}/file?download=1`}>
              <I.download size={12} /> PDF
            </a>
          </div>
        )}

        <div className="tiny faint">Converted PDFs are also saved to your library, so you can edit, sign, search or ask AI about them.</div>
      </div>
    </Modal>
  );
}
