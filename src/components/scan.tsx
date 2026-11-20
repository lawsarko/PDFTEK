"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errMsg } from "@/lib/client/api";
import { enhance, imagesToPdf, toJpeg } from "@/lib/client/images";
import { I } from "./icons";
import { Modal } from "./modal";

/**
 * Scan paper with the camera and get a PDF. Used wherever a document can be uploaded: the
 * workbench, bank statement / invoice / receipt to Excel, the PDF tools, Files → PDF, and the
 * public document-request page. Works without an account or workspace.
 *
 * Two ways to capture, so it works on every device:
 *   - the live camera in the page, with a page guide, auto-crop and enhance;
 *   - the phone's own camera app (or photo library), for browsers that block the live camera.
 * Every captured page becomes one page of the PDF.
 */

type Page = { id: string; url: string; bytes: Uint8Array; width: number; height: number };

const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");

export function ScanCapture({
  onDone,
  saveLabel = "Save as PDF",
  baseName = "Scan",
  hint,
}: {
  /** Receives the finished PDF. Errors thrown here are shown in the scanner. */
  onDone: (file: File) => Promise<void> | void;
  saveLabel?: string;
  baseName?: string;
  /** A line of guidance shown above the camera, e.g. "One receipt per scan". */
  hint?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [doEnhance, setDoEnhance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("The live camera isn't available in this browser. Use “Take photos” below instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      .then((m) => {
        if (cancelled) return m.getTracks().forEach((t) => t.stop());
        streamRef.current = m;
        setStream(m);
        if (video.current) video.current.srcObject = m;
      })
      .catch(() => setCameraError("Camera access was blocked or no camera was found. Use “Take photos” below, or allow the camera in your browser settings."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const addPage = (j: Omit<Page, "id">) => setPages((p) => [...p, { id: Math.random().toString(36).slice(2), ...j }]);

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // Crop to the guide frame (A4 portrait ratio, centered).
    const ratio = 1 / 1.414;
    let cw = v.videoWidth * 0.86;
    let ch = cw / ratio;
    if (ch > v.videoHeight * 0.94) {
      ch = v.videoHeight * 0.94;
      cw = ch * ratio;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw);
    canvas.height = Math.round(ch);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, cw, ch);
    if (doEnhance) enhance(ctx, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.88));
    addPage(await toJpeg(blob));
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    for (const f of files) {
      try {
        addPage(await toJpeg(f, { enhance: doEnhance }));
      } catch (e) {
        setError(`${f.name}: ${errMsg(e)}`);
      }
    }
    if (photos.current) photos.current.value = "";
  };

  const move = (i: number, d: -1 | 1) =>
    setPages((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const copy = [...p];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const pdf = await imagesToPdf(pages, "fit");
      await onDone(new File([pdf as BlobPart], `${baseName} ${stamp()}.pdf`, { type: "application/pdf" }));
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="col gap-12">
      {hint && <div className="small muted">{hint}</div>}
      {cameraError ? (
        <div className="notice">{cameraError}</div>
      ) : (
        <div className="scan-view">
          <video ref={video} autoPlay playsInline muted />
          <div className="scan-guide" />
          {!stream && (
            <div className="scan-wait">
              <span className="spinner spinner-lg" />
            </div>
          )}
        </div>
      )}

      <div className="row between wrap gap-8">
        <label className="check">
          <input type="checkbox" checked={doEnhance} onChange={(e) => setDoEnhance(e.target.checked)} /> Auto-crop & enhance
        </label>
        <span className="mono small muted">
          {pages.length} page{pages.length === 1 ? "" : "s"}
        </span>
      </div>

      {pages.length > 0 && (
        <div className="row gap-8" style={{ overflowX: "auto", paddingBottom: 4 }}>
          {pages.map((p, i) => (
            <div key={p.id} className="scan-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Page ${i + 1}`} />
              <span className="scan-thumb-n mono">{i + 1}</span>
              <div className="scan-thumb-actions">
                {i > 0 && (
                  <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move page earlier">
                    <I.left size={11} />
                  </button>
                )}
                <button className="icon-btn" onClick={() => setPages(pages.filter((x) => x.id !== p.id))} aria-label="Remove page">
                  <I.x size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="notice notice-bad">{error}</div>}

      <div className="row wrap gap-8 scan-actions">
        <button className="btn" onClick={() => photos.current?.click()}>
          <I.image size={14} /> Take photos
        </button>
        <input ref={photos} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
        <div className="grow" />
        {!cameraError && (
          <button className="btn" disabled={!stream} onClick={() => void capture()}>
            <I.camera size={14} /> Capture page
          </button>
        )}
        <button className="btn btn-primary" disabled={!pages.length || busy} onClick={() => void save()}>
          {busy && <span className="spinner" />} {saveLabel}
        </button>
      </div>
    </div>
  );
}

/** The scanner in a window. */
export function ScanModal({
  title = "Scan with your camera",
  onClose,
  onScanned,
  saveLabel,
  baseName,
  hint,
}: {
  title?: string;
  onClose: () => void;
  onScanned: (file: File) => Promise<void> | void;
  saveLabel?: string;
  baseName?: string;
  hint?: string;
}) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <ScanCapture
        saveLabel={saveLabel}
        baseName={baseName}
        hint={hint}
        onDone={async (f) => {
          await onScanned(f);
          onClose();
        }}
      />
    </Modal>
  );
}

/** A "Scan" button that opens the scanner and hands back the PDF. */
export function ScanButton({
  onScanned,
  label = "Scan with camera",
  className = "btn btn-sm",
  ...rest
}: {
  onScanned: (file: File) => Promise<void> | void;
  label?: string;
  className?: string;
  title?: string;
  saveLabel?: string;
  baseName?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <I.camera size={13} /> {label}
      </button>
      {/* Rendered at page level, so it stacks correctly when opened from inside another window. */}
      {open && createPortal(<ScanModal onClose={() => setOpen(false)} onScanned={onScanned} {...rest} />, document.body)}
    </>
  );
}
