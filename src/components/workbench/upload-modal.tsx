"use client";
import { useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { imagesToPdf, toJpeg, isTiffName, tiffPages } from "@/lib/client/images";
import { ScanCapture } from "../scan";
import { I } from "../icons";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";

const ACCEPT = ".pdf,.doc,.docx,.odt,.rtf,.txt,.md,.ppt,.pptx,.odp,.xls,.xlsx,.ods,.csv,.html,.jpg,.jpeg,.png,.webp,.heic,.gif,.bmp,.tif,.tiff";
const IMAGE_RE = /\.(webp|heic|gif|bmp)$/i;
// TIFF is converted on the server (most browsers can't read it), with every page of multi-page files.

type Tab = "upload" | "images" | "scan";

export function UploadModal({ onClose, initialTab = "upload" }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <Modal title="Add documents" onClose={onClose} wide={tab !== "upload"}>
      <div className="tabs" style={{ margin: "-18px -18px 18px" }}>
        <button className={`tab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>Upload files</button>
        <button className={`tab ${tab === "images" ? "active" : ""}`} onClick={() => setTab("images")}>Images → PDF</button>
        <button className={`tab ${tab === "scan" ? "active" : ""}`} onClick={() => setTab("scan")}>Scan with camera</button>
      </div>
      {tab === "upload" && <UploadFiles onDone={onClose} />}
      {tab === "images" && <ImagesToPdf onDone={onClose} />}
      {tab === "scan" && <Scanner onDone={onClose} />}
    </Modal>
  );
}

export function useUploader() {
  const { wid, upsertDoc, openDoc, reloadInfo } = useWB();
  const toast = useToast();
  return async (files: File[], tags = "", task?: string) => {
    // PDFs built in the browser (images, camera scans) count as one task before they're saved.
    if (task) await api(`/api/workspaces/${wid}/usage`, { method: "POST", json: { action: "task", label: task } });
    const form = new FormData();
    // Formats the server can't read (webp/heic/…) are normalized to JPEG in the browser first.
    for (const f of files) {
      if (IMAGE_RE.test(f.name)) {
        const j = await toJpeg(f);
        form.append("files", new File([j.bytes as BlobPart], f.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      } else form.append("files", f);
    }
    if (tags) form.append("tags", tags);
    const r = await api<{ documents: Doc[]; errors: { name: string; error: string }[] }>(`/api/workspaces/${wid}/documents`, { method: "POST", body: form });
    r.documents.forEach(upsertDoc);
    r.errors.forEach((e) => toast(`${e.name}: ${e.error}`, "error"));
    if (r.documents[0]) openDoc(r.documents[0].id);
    void reloadInfo();
    return r.documents;
  };
}

function UploadFiles({ onDone }: { onDone: () => void }) {
  const upload = useUploader();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const docs = await upload(files, tags);
      if (docs.length) toast(`Added ${docs.length} document${docs.length > 1 ? "s" : ""} to your knowledge base`, "success");
      onDone();
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  return (
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
          setFiles((f) => [...f, ...e.dataTransfer.files]);
        }}
      >
        <I.upload size={26} />
        <div style={{ marginTop: 8, fontWeight: 500 }}>
          Drag files here, or <span style={{ color: "var(--amber)" }}>browse</span>
        </div>
        <div className="small muted mt-8">Up to 20 files · 60 MB each · any language</div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => setFiles((f) => [...f, ...(e.target.files ?? [])])} />
      </div>
      {files.length > 0 && (
        <div className="card card-tight">
          {files.map((f, i) => (
            <div key={i} className="row small" style={{ padding: "4px 0" }}>
              <I.file size={14} />
              <span className="grow ellipsis">{f.name}</span>
              <span className="mono faint tiny">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">
                <I.x size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <label>Tags (optional, comma-separated)</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="contracts, vendor, 2025" />
      </div>
      <div className="row wrap gap-16 small muted">
        <span><b style={{ color: "var(--text-hi)" }}>Documents:</b> PDF, DOCX, PPTX, XLSX, TXT, RTF, CSV</span>
        <span><b style={{ color: "var(--text-hi)" }}>Images & scans:</b> JPG, PNG, WEBP, TIFF (OCR in-app)</span>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={!files.length || busy} onClick={submit}>
          {busy ? <span className="spinner" /> : <I.upload size={14} />} {busy ? "Processing…" : `Upload ${files.length || ""}`}
        </button>
      </div>
    </div>
  );
}

type Img = { id: string; url: string; bytes: Uint8Array; width: number; height: number };

function ImagesToPdf({ onDone }: { onDone: () => void }) {
  const upload = useUploader();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [size, setSize] = useState<"fit" | "a4" | "letter">("a4");
  const [name, setName] = useState("Images");
  const [busy, setBusy] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const add = async (files: FileList | File[]) => {
    for (const f of files) {
      try {
        // Every page of a multi-page TIFF becomes its own image.
        const sources = isTiffName(f.name) ? await tiffPages(f) : [f];
        for (const src of sources) {
          const j = await toJpeg(src);
          setImages((l) => [...l, { id: Math.random().toString(36).slice(2), ...j }]);
        }
      } catch (e) {
        toast(`${f.name}: ${errMsg(e)}`, "error");
      }
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const pdf = await imagesToPdf(images, size);
      await upload([new File([pdf as BlobPart], `${name.trim() || "Images"}.pdf`, { type: "application/pdf" })], "", "JPG to PDF");
      toast("PDF created", "success");
      onDone();
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  return (
    <div className="col gap-16">
      <div className="thumbs">
        {images.map((im, i) => (
          <div
            key={im.id}
            className={`thumb ${dragIdx === i ? "dragging" : ""}`}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx === null) return;
              const copy = [...images];
              const [m] = copy.splice(dragIdx, 1);
              copy.splice(i, 0, m);
              setImages(copy);
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt="" style={{ height: 120, objectFit: "contain" }} />
            <span className="tiny mono faint">{i + 1}</span>
            <div className="thumb-actions">
              <button className="icon-btn" onClick={() => setImages(images.filter((x) => x.id !== im.id))} aria-label="Remove">
                <I.x size={12} />
              </button>
            </div>
          </div>
        ))}
        <button className="thumb" style={{ justifyContent: "center", minHeight: 160, cursor: "pointer", color: "var(--text-lo)" }} onClick={() => input.current?.click()}>
          <I.plus size={22} />
          <span className="small">Add images</span>
        </button>
      </div>
      <input ref={input} type="file" multiple accept="image/*,.tif,.tiff" hidden onChange={(e) => e.target.files && add(e.target.files)} />
      <div className="small muted">Drag thumbnails to reorder pages · JPG, PNG, WEBP, HEIC (Safari) accepted</div>
      <div className="row wrap gap-12">
        <div className="field grow">
          <label>File name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Page size</label>
          <select className="select" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="fit">Fit to image</option>
          </select>
        </div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={!images.length || busy} onClick={create}>
          {busy && <span className="spinner" />} Create PDF ({images.length} page{images.length === 1 ? "" : "s"})
        </button>
      </div>
    </div>
  );
}

function Scanner({ onDone }: { onDone: () => void }) {
  const upload = useUploader();
  const toast = useToast();
  return (
    <ScanCapture
      onDone={async (file) => {
        await upload([file], "scan", "Scan to PDF");
        toast("Scan saved. Run OCR from the document toolbar to make it searchable.", "success");
        onDone();
      }}
    />
  );
}
