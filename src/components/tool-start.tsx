"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { I } from "./icons";
import { Modal } from "./modal";
import { ScanButton } from "./scan";
import { CloudImport, type CloudKind } from "./cloud";
import { useT } from "./i18n";

/**
 * The upload area on the public tool pages (/merge-pdf, /pdf-to-word, …): drop or choose files, scan
 * them with the camera, or pick them from Google Drive, Dropbox or OneDrive, and land straight in the
 * tool with the files already open. No "which document?" step in between.
 */

type Target =
  | { to: "do"; action: string } // workbench, run a ribbon action on the document
  | { to: "open" } // workbench, just open it
  | { to: "fill" | "sign" | "template" | "compare" | "merge" | "images" }
  | { to: "unlock" } // locked PDFs can't go in the library: ask for the password here first
  | { to: "excel"; kind: "statement" | "invoice" | "bulk" };

type Setup = { target: Target; accept: string; multiple: boolean; cloud: CloudKind; drop: string; label: string; scanFirst?: boolean };

const PDF = ".pdf,application/pdf";
const PDF_OR_PHOTO = ".pdf,application/pdf,image/*,.heic";
const OFFICE = ".doc,.docx,.odt,.rtf,.txt,.md,.html,.htm,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp";
const IMAGES = "image/*,.heic,.tif,.tiff";
const ANY = `${PDF},${OFFICE},${IMAGES}`;

const PDF_TEXT = { drop: "Drop your PDF here", label: "Choose PDF" };
const one = (action: string, text: { drop: string; label: string } = PDF_TEXT): Setup => ({ target: { to: "do", action }, accept: PDF, multiple: false, cloud: "pdf", ...text });

/** By the page's /go/<key> (the same keys as TOOL_START_KEYS in lib/tool-start.ts). */
const SETUPS: Record<string, Setup> = {
  "pdf-to-word": one("convert-docx"),
  "pdf-to-excel": one("convert-xlsx"),
  "pdf-to-powerpoint": one("convert-pptx"),
  "pdf-to-jpg": one("convert-jpg"),
  "word-to-pdf": { target: { to: "open" }, accept: OFFICE, multiple: false, cloud: "documents", drop: "Drop your Word document here", label: "Choose Word file" },
  "excel-to-pdf": { target: { to: "open" }, accept: OFFICE, multiple: false, cloud: "documents", drop: "Drop your Excel file here", label: "Choose Excel file" },
  "powerpoint-to-pdf": { target: { to: "open" }, accept: OFFICE, multiple: false, cloud: "documents", drop: "Drop your PowerPoint here", label: "Choose PowerPoint file" },
  "to-pdf": { target: { to: "open" }, accept: `${IMAGES},${OFFICE}`, multiple: false, cloud: "documents", drop: "Drop your TIFF or other file here", label: "Choose file" },
  "jpg-to-pdf": { target: { to: "images" }, accept: IMAGES, multiple: true, cloud: "pdfOrImage", drop: "Drop your images here", label: "Choose images" },
  "scan-to-pdf": { target: { to: "open" }, accept: `${PDF},${IMAGES}`, multiple: false, cloud: "pdfOrImage", drop: "Scan paper documents with your camera", label: "Choose a photo or PDF", scanFirst: true },
  "bank-statement-to-excel": { target: { to: "excel", kind: "statement" }, accept: PDF_OR_PHOTO, multiple: true, cloud: "pdfOrImage", drop: "Drop your bank statements here", label: "Choose statements" },
  "invoice-to-excel": { target: { to: "excel", kind: "invoice" }, accept: PDF_OR_PHOTO, multiple: true, cloud: "pdfOrImage", drop: "Drop invoices or receipts here", label: "Choose invoices or receipts" },
  "bulk-convert": { target: { to: "excel", kind: "bulk" }, accept: PDF, multiple: true, cloud: "pdf", drop: "Drop your PDFs here", label: "Choose PDFs" },
  merge: { target: { to: "merge" }, accept: PDF, multiple: true, cloud: "pdf", drop: "Drop the PDFs to combine here", label: "Choose PDFs" },
  split: one("split"),
  organize: one("organize"),
  rotate: one("rotate"),
  "page-numbers": one("page_numbers"),
  compress: one("optimize"),
  protect: one("protect"),
  unlock: { target: { to: "unlock" }, accept: PDF, multiple: false, cloud: "pdf", drop: "Drop your password-protected PDF here", label: "Choose PDF" },
  watermark: one("watermark"),
  "fill-form": { target: { to: "fill" }, accept: PDF_OR_PHOTO, multiple: false, cloud: "pdfOrImage", drop: "Drop your form here (PDF or photo)", label: "Choose form" },
  edit: one("edit"),
  sign: { target: { to: "sign" }, accept: `${PDF},${OFFICE}`, multiple: false, cloud: "documents", drop: "Drop the document to be signed here", label: "Choose document" },
  ocr: { ...one("ocr", { drop: "Drop your scanned PDF here", label: "Choose scan" }), accept: `${PDF},${IMAGES}`, cloud: "pdfOrImage" },
  "read-aloud": one("read"),
  ask: { ...one("ask"), accept: ANY, cloud: "documents", drop: "Drop your document here", label: "Choose document" },
  translate: one("translate"),
  compare: { target: { to: "compare" }, accept: `${PDF},${OFFICE}`, multiple: true, cloud: "documents", drop: "Drop the two versions to compare here", label: "Choose 2 files" },
  "esign-templates": { target: { to: "template" }, accept: `${PDF},${OFFICE}`, multiple: false, cloud: "documents", drop: "Drop the document for your template here", label: "Choose document" },
  "signing-links": { target: { to: "template" }, accept: `${PDF},${OFFICE}`, multiple: false, cloud: "documents", drop: "Drop the document people will sign here", label: "Choose document" },
  cloud: { target: { to: "open" }, accept: ANY, multiple: true, cloud: "documents", drop: "Open files from your cloud storage, or drop them here", label: "Choose files" },
};

/** Where the person lands once their files are in the library. */
async function destination(wid: string, setup: Setup, docs: Doc[]): Promise<string> {
  const t = setup.target;
  const first = docs[0].id;
  const ids = docs.map((d) => d.id);
  switch (t.to) {
    case "do":
      return `/app/${wid}?doc=${first}&do=${t.action}`;
    case "open":
    case "unlock":
      return `/app/${wid}?doc=${first}`;
    case "fill":
      return `/app/${wid}/fill/${first}`;
    case "sign":
      return `/app/${wid}/send/${first}`;
    case "template":
      return `/app/${wid}/send/${first}?mode=template`;
    case "compare":
      return `/app/${wid}/compare?a=${first}${ids[1] ? `&b=${ids[1]}` : ""}`;
    case "merge":
      return `/app/${wid}/tools?tool=merge&docs=${ids.join(",")}`;
    case "images": {
      if (docs.length < 2) return `/app/${wid}?doc=${first}`;
      // Several photos: one PDF with a page per photo, in the order chosen.
      const r = await api<{ documents: Doc[] }>(`/api/workspaces/${wid}/tools`, { method: "POST", json: { op: "merge", docIds: ids, name: "Images" } });
      return `/app/${wid}?doc=${r.documents[0].id}`;
    }
    case "excel": {
      // The Excel page keeps its queue per workspace; add these files to it.
      try {
        const key = `fx:${wid}:${t.kind}`;
        const queued: string[] = JSON.parse(sessionStorage.getItem(key) ?? "[]");
        sessionStorage.setItem(key, JSON.stringify([...queued.filter((id) => !ids.includes(id)), ...ids]));
      } catch {}
      return `/app/${wid}/to-excel?kind=${t.kind}${t.kind === "bulk" ? "" : `&doc=${first}`}`;
    }
  }
}

let session: Promise<string> | null = null;
/** The workspace files go to: starts a (guest) session the first time it's needed. */
function workspace(): Promise<string> {
  session ??= api<{ workspaceId: string }>("/api/start", { method: "POST" })
    .then((r) => r.workspaceId)
    .catch((e) => {
      session = null;
      throw e;
    });
  return session;
}

export function ToolStart({ go, note }: { go: string; note: string }) {
  const t = useT();
  const setup = SETUPS[go];
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloudOk, setCloudOk] = useState(false);
  const [cloudWid, setCloudWid] = useState<string | null>(null);
  // Unlock PDF: the chosen locked file, waiting for its password.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    fetch("/api/cloud/available")
      .then((r) => r.json())
      .then((r: { available?: boolean }) => setCloudOk(!!r.available))
      .catch(() => {});
    // Back from connecting a cloud account: open the picker again.
    const params = new URLSearchParams(window.location.search);
    if (params.get("cloudpick") === "start") {
      const bad = params.get("cloud_error");
      ["cloudpick", "cloud", "cloud_error"].forEach((k) => params.delete(k));
      const q = params.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (q ? `?${q}` : ""));
      if (bad) setError(bad);
      else workspace().then(setCloudWid, (e) => setError(errMsg(e)));
    }
  }, []);

  if (!setup) return null;

  const finish = async (docs: Doc[]) => {
    if (!docs.length) return;
    setBusy(t("Opening…"));
    try {
      window.location.assign(await destination(await workspace(), setup, docs));
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  };

  const upload = async (list: FileList | File[] | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setError(null);
    if (setup.target.to === "unlock") {
      setLocked(files[0]);
      setPassword("");
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(files.length > 1 ? t("Uploading {n} files…", { n: files.length }) : t("Uploading…"));
    try {
      const wid = await workspace();
      const form = new FormData();
      for (const f of setup.multiple ? files : files.slice(0, 1)) form.append("files", f);
      const r = await api<{ documents: Doc[]; errors: { name: string; error: string }[] }>(`/api/workspaces/${wid}/documents`, { method: "POST", body: form });
      if (!r.documents.length) throw new Error(r.errors[0] ? `${r.errors[0].name}: ${r.errors[0].error}` : t("That file couldn't be opened. Please try another."));
      if (r.errors.length) setError(r.errors.map((e) => `${e.name}: ${e.error}`).join(" · "));
      await finish(r.documents);
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const unlock = async () => {
    if (!locked) return;
    setError(null);
    setBusy(t("Removing the password…"));
    try {
      const wid = await workspace();
      const form = new FormData();
      form.append("file", locked);
      form.append("password", password);
      const r = await api<{ document: Doc }>(`/api/workspaces/${wid}/unlock`, { method: "POST", body: form });
      await finish([r.document]);
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  };

  const openCloud = async () => {
    setError(null);
    try {
      setCloudWid(await workspace());
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const returnTo = () => {
    const p = new URLSearchParams(window.location.search);
    p.set("cloudpick", "start");
    return `${window.location.pathname}?${p.toString()}`;
  };

  return (
    <div className="ts-wrap">
      <div
        className={`ts-drop ${over ? "over" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) void upload(e.dataTransfer.files);
        }}
      >
        {busy ? (
          <div className="ts-busy" role="status" aria-live="polite">
            <span className="spinner" /> {busy}
          </div>
        ) : locked ? (
          <form
            className="ts-unlock"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <div className="ts-file">
              <I.lock size={16} /> <span className="ellipsis">{locked.name}</span>
            </div>
            <label className="ts-label" htmlFor="ts-password">
              {t("Password")}
            </label>
            <input id="ts-password" className="input" type="password" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("The password used to open the PDF")} />
            <div className="ts-hint">{t("Leave it empty if the PDF opens without a password but blocks printing or copying.")}</div>
            <div className="ts-actions">
              <button type="submit" className="btn btn-primary btn-lg">
                <I.unlock size={16} /> {t("Remove password")}
              </button>
              <button type="button" className="btn btn-lg" onClick={() => (setLocked(null), setError(null))}>
                {t("Choose another file")}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="ts-ico" aria-hidden>
              {setup.scanFirst ? <I.camera size={22} /> : <I.upload size={22} />}
            </div>
            <div className="ts-title">{t(setup.drop)}</div>
            <div className="ts-actions">
              {setup.scanFirst ? (
                <ScanButton className="btn btn-primary btn-lg btn-glow" label={t("Scan with camera")} onScanned={(f) => upload([f])} />
              ) : (
                <button type="button" className="btn btn-primary btn-lg btn-glow" onClick={() => input.current?.click()}>
                  <I.upload size={16} /> {t(setup.label)}
                </button>
              )}
              {setup.scanFirst ? (
                <button type="button" className="btn btn-lg" onClick={() => input.current?.click()}>
                  <I.upload size={16} /> {t(setup.label)}
                </button>
              ) : (
                <ScanButton className="btn btn-lg" label={t("Scan with camera")} onScanned={(f) => upload([f])} />
              )}
              {cloudOk && (
                <button type="button" className="btn btn-lg" onClick={() => void openCloud()}>
                  <I.cloud size={16} /> {t("From cloud")}
                </button>
              )}
            </div>
            <div className="ts-note">{note}</div>
          </>
        )}
        <input ref={input} type="file" hidden accept={setup.accept} multiple={setup.multiple} onChange={(e) => void upload(e.target.files)} />
      </div>
      {error && (
        <div className="ts-error" role="alert">
          {error}
        </div>
      )}
      {cloudWid &&
        createPortal(
          <Modal title={t("Open from cloud storage")} onClose={() => setCloudWid(null)}>
            {setup.target.to === "unlock" ? (
              <CloudImport
                wid={cloudWid}
                kind={setup.cloud}
                multiple={false}
                returnTo={returnTo()}
                onFiles={(files) => {
                  setCloudWid(null);
                  void upload(files);
                }}
              />
            ) : (
              <CloudImport
                wid={cloudWid}
                kind={setup.cloud}
                multiple={setup.multiple}
                returnTo={returnTo()}
                onImported={(docs) => {
                  setCloudWid(null);
                  void finish(docs);
                }}
              />
            )}
          </Modal>,
          document.body,
        )}
    </div>
  );
}
