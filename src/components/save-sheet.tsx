"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "./icons";
import { useToast } from "./toast";
import { DOWNLOADED, FILE_READY, isHandheld, saveBlob } from "@/lib/client/api";

/**
 * Phones and tablets: instead of a silent download that lands somewhere hard to find, every file
 * pdftek produces opens a "Your file is ready" sheet. From there the person can use the system
 * share sheet (Save to Files, iCloud Drive, Google Drive, Photos, email…), open it, or download it
 * the classic way. Desktop downloads stay direct, with a short confirmation.
 *
 * download() in lib/client/api.ts sends files here through window events, and links to
 * /api/…?download=1 are caught on click, so every download path in the app is covered.
 */

const isIOS = () =>
  typeof navigator !== "undefined" && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
};
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const typeFor = (name: string, fallback: string) => TYPES[extOf(name)] || fallback || "application/octet-stream";
/** Types a phone can show by itself in a new tab. */
const viewable = (type: string) => /^(application\/pdf|image\/|text\/plain)/.test(type);

function sizeLabel(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** File name from a Content-Disposition header (handles filename*=UTF-8''…). */
function nameFromHeader(h: string | null, fallback: string) {
  if (!h) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(h);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {}
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(h);
  return plain ? plain[1].trim() : fallback;
}

type Ready = { file: File; url: string };
type State = { status: "loading"; name: string } | { status: "ready"; ready: Ready } | { status: "error"; message: string } | null;

export function SaveSheetHost() {
  const toast = useToast();
  const [state, setState] = useState<State>(null);
  const urlRef = useRef<string | null>(null);

  const show = useCallback((blob: Blob, name: string) => {
    const file = new File([blob], name, { type: typeFor(name, blob.type) });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setState({ status: "ready", ready: { file, url } });
  }, []);

  const close = useCallback(() => {
    setState(null);
    const u = urlRef.current;
    urlRef.current = null;
    // Keep the link alive a little in case a tab opened from it is still loading.
    if (u) setTimeout(() => URL.revokeObjectURL(u), 60_000);
  }, []);

  useEffect(() => {
    (window as unknown as { __pdftekSaveSheet?: boolean }).__pdftekSaveSheet = true;
    const onReady = (e: Event) => {
      const { blob, name } = (e as CustomEvent<{ blob: Blob; name: string }>).detail;
      show(blob, name);
    };
    const onDownloaded = () => toast("Downloaded. You'll find it in your Downloads folder.", "success");

    // Links to server files (…?download=1) are fetched and shown in the sheet on phones.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.href.startsWith("blob:") || a.dataset.directDownload !== undefined) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.searchParams.get("download") !== "1" && !a.hasAttribute("download")) return;
      if (!isHandheld()) return;
      e.preventDefault();
      const fallback = a.getAttribute("download") || "document.pdf";
      setState({ status: "loading", name: fallback });
      fetch(url, { credentials: "same-origin" })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Couldn't prepare the file. Please try again.");
          show(await r.blob(), nameFromHeader(r.headers.get("content-disposition"), fallback));
        })
        .catch((err) => setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't prepare the file. Please try again." }));
    };

    window.addEventListener(FILE_READY, onReady);
    window.addEventListener(DOWNLOADED, onDownloaded);
    document.addEventListener("click", onClick);
    return () => {
      (window as unknown as { __pdftekSaveSheet?: boolean }).__pdftekSaveSheet = false;
      window.removeEventListener(FILE_READY, onReady);
      window.removeEventListener(DOWNLOADED, onDownloaded);
      document.removeEventListener("click", onClick);
    };
  }, [show, toast]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  if (!state) return null;
  const ready = state.status === "ready" ? state.ready : null;
  const canShare = !!ready && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [ready.file] });
  const ios = isIOS();

  const share = async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: [ready.file], title: ready.file.name });
      close();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // they closed the share sheet; keep ours open
      saveBlob(ready.file, ready.file.name);
      close();
    }
  };
  const downloadIt = () => {
    if (!ready) return;
    saveBlob(ready.file, ready.file.name);
    toast(ios ? "Downloading. Find it in the Files app → Downloads." : "Downloading. Find it in your Downloads folder.", "success");
    close();
  };

  return (
    <div className="save-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="save-sheet" role="dialog" aria-modal="true" aria-labelledby="save-title">
        <div className="save-grip" aria-hidden />
        <div className="row between">
          <h2 id="save-title" className="save-title">
            {state.status === "loading" ? "Preparing your file…" : state.status === "error" ? "Something went wrong" : "Your file is ready"}
          </h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <I.x size={18} />
          </button>
        </div>

        {state.status === "loading" && (
          <div className="save-file">
            <span className="spinner" />
            <span className="ellipsis" data-no-translate>{state.name}</span>
          </div>
        )}
        {state.status === "error" && <p className="small muted">{state.message}</p>}

        {ready && (
          <>
            <div className="save-file">
              <span className="save-ext" data-no-translate>{extOf(ready.file.name).toUpperCase() || "FILE"}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis save-name" data-no-translate>{ready.file.name}</span>
                <span className="tiny faint">{sizeLabel(ready.file.size)}</span>
              </span>
            </div>

            <div className="save-actions">
              {canShare && (
                <button className="btn btn-primary save-btn" onClick={share}>
                  <I.folder size={18} />
                  <span className="grow">
                    {ios ? "Save to Files or share" : "Save or share"}
                    <span className="save-hint">{ios ? "Files, iCloud Drive, Photos, email, WhatsApp…" : "Google Drive, email, WhatsApp, other apps…"}</span>
                  </span>
                </button>
              )}
              <button className={`btn save-btn ${canShare ? "" : "btn-primary"}`} onClick={downloadIt}>
                <I.download size={18} />
                <span className="grow">
                  Download to this device
                  <span className="save-hint">{ios ? "Goes to the Files app → Downloads" : "Goes to your Downloads folder"}</span>
                </span>
              </button>
              {viewable(ready.file.type) && (
                <a className="btn save-btn" href={ready.url} target="_blank" rel="noopener" data-direct-download>
                  <I.file size={18} />
                  <span className="grow">
                    Open
                    <span className="save-hint">View it now in a new tab</span>
                  </span>
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
