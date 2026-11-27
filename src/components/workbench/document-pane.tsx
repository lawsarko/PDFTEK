"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Editor, type EditorTool } from "./editor";
import { RIBBON, needsDoc } from "./ribbon";
import { ToolArt, ToolsPanel } from "./tools-panel";
import { PageRail } from "./thumbs";
import { FileBadge, Home, RenameModal, TagModal } from "./home";
import { Assistant } from "./assistant";
import { AccountButtons, GlobalSearch } from "./topbar";

const ACTS = RIBBON.flatMap((g) => g.acts);
/** The phone's Tools sheet: the most used tools, then "All tools". */
const PHONE_TOOLS = ["convert-docx", "edit", "sign", "fill", "organize", "optimize", "protect", "translate"];
const PREFS = "pdftek-doc-panels";
import { ToolModal, UnlockModal, type ToolKey } from "../tools/tool-modals";
import { TranslateModal } from "../tools/translate-modal";
import { SaveToCloudModal } from "../cloud";
import { ConvertToPdfModal } from "../convert-to-pdf";

export function DocumentPane() {
  const { active, info, docs, showUpload, queueAction, flash, upsertDoc, requirePro, wid, openDoc, aiOpen, openAI, closeAI, jump, reloadDocs } = useWB();
  const toast = useToast();
  const [scale, setScale] = useState(1.25);
  const [page, setPage] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [tts, setTts] = useState(false);
  const [editing, setEditing] = useState<EditorTool | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [toolModal, setToolModal] = useState<ToolKey | null>(null);
  const [toPdf, setToPdf] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [cloudSave, setCloudSave] = useState(false);
  const translated = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fitDone, setFitDone] = useState(false);
  // Side panels in the document view (remembered): every tool, and page thumbnails.
  const [toolsOpen, setToolsOpen] = useState(true);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [sheet, setSheet] = useState<null | "tools" | "all">(null);
  const [renaming, setRenaming] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  // "/" opens search in the document view too.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      setFindOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || "{}") as { tools?: boolean; pages?: boolean };
      if (p.tools === false) setToolsOpen(false);
      if (p.pages === false) setPagesOpen(false);
    } catch {}
  }, []);
  const setPref = (k: "tools" | "pages", v: boolean) => {
    (k === "tools" ? setToolsOpen : setPagesOpen)(v);
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || "{}") as Record<string, boolean>;
      localStorage.setItem(PREFS, JSON.stringify({ ...p, [k]: v }));
    } catch {}
  };

  const src = active ? `/api/documents/${active.id}/file?version=${active.versionId}` : "";

  // Deep links (?do=edit|ocr|convert-docx|…) and tools picked before an upload run once the PDF has loaded.
  const router = useRouter();
  const params = useSearchParams();
  const doAction = params.get("do");
  const actionRef = useRef<(a: string) => void>(undefined);
  useEffect(() => {
    if (!doAction || !pdf || !active) return;
    router.replace(`/app/${wid}?doc=${active.id}`, { scroll: false });
    actionRef.current?.(doAction);
  }, [doAction, pdf, active, router, wid]);

  // Fit width on first load.
  const onLoaded = useCallback(
    async (d: PDFDocumentProxy) => {
      setPdf(d);
      if (fitDone) return;
      const p = await d.getPage(1);
      const w = p.getViewport({ scale: 1 }).width;
      const avail = (scrollRef.current?.clientWidth ?? 800) - 48;
      setScale(Math.max(0.5, Math.min(1.5, avail / w)));
      setFitDone(true);
    },
    [fitDone],
  );

  const me = info.me.id;
  const member = info.billing.membership;
  const lockedByOther = Boolean(active?.checkedOutBy && active.checkedOutBy.id !== me);
  const lockedByMe = active?.checkedOutBy?.id === me;

  const toggleLock = async () => {
    if (!active) return;
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${active.id}/checkout`, { method: "POST", json: { action: lockedByMe ? "checkin" : "checkout" } });
      upsertDoc(r.document);
      toast(lockedByMe ? "Checked in — teammates can edit again" : "Checked out — you have the edit lock", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const convert = async (kind: string, pages?: number[]) => {
    setFormatsOpen(false);
    if (!pdf || !active) return;
    // Word/Excel are converted (and counted) on the server; the rest run in the browser and report a task first.
    if (kind !== "docx" && kind !== "xlsx") {
      try {
        await api(`/api/workspaces/${wid}/usage`, { method: "POST", json: { action: "task", label: `PDF to ${kind.toUpperCase()}` } });
      } catch (e) {
        toast(errMsg(e), "error");
        return;
      }
    }
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

  const startEdit = (tool: EditorTool) => {
    if (lockedByOther) return toast(`${active?.checkedOutBy?.name} has the edit lock. You can edit once it's checked in or handed to you.`, "info");
    if (requirePro("Edit PDF")) setEditing(tool);
  };
  const toAssistant = (tab: string) => {
    openAI(tab);
  };
  const ask = (question: string, submit: boolean) => {
    toAssistant("chat");
    setTimeout(() => window.dispatchEvent(new CustomEvent("pdftek:ask", { detail: { question, submit } })), 250);
  };

  /** Runs a tool from the ribbon (or a deep link) on the open document. */
  const run = (key: string) => {
    if (!active && needsDoc(key)) {
      queueAction(key);
      return;
    }
    if (key.startsWith("convert-")) {
      if (key === "convert-more") setFormatsOpen((v) => !v);
      else void convert(key.slice(8));
      return;
    }
    switch (key) {
      case "statement":
      case "invoice":
        router.push(`/app/${wid}/to-excel?kind=${key}${active ? `&doc=${active.id}` : ""}`);
        break;
      case "topdf":
        setToPdf(true);
        break;
      case "images":
      case "scan":
        showUpload(key);
        break;
      case "ocr":
        setOcrOpen(true);
        break;
      case "edit":
        startEdit("select");
        break;
      case "edit-text":
        startEdit("text");
        break;
      case "edit-mark":
        startEdit("mark");
        break;
      case "edit-ink":
        startEdit("ink");
        break;
      case "redact":
        startEdit("redact");
        break;
      case "watermark":
      case "page_numbers":
      case "metadata":
      case "organize":
      case "merge":
      case "split":
      case "extract":
      case "delete_pages":
      case "rotate":
      case "optimize":
      case "protect":
        setToolModal(key);
        break;
      case "compare":
        router.push(`/app/${wid}/compare${active ? `?a=${active.id}` : ""}`);
        break;
      case "fill":
        router.push(`/app/${wid}/fill/${active!.id}`);
        break;
      case "sign":
        if (requirePro("E-signatures")) router.push(`/app/${wid}/send/${active!.id}`);
        break;
      case "save-template":
        if (requirePro("E-signature templates")) router.push(`/app/${wid}/send/${active!.id}?mode=template`);
        break;
      case "sign-hub":
        router.push(`/app/${wid}/signatures`);
        break;
      case "request":
        if (requirePro("Document requests")) router.push(`/app/${wid}/requests?new=1`);
        break;
      case "handoff":
        setHandoffOpen(true);
        break;
      case "unlock":
        setUnlock(true);
        break;
      case "versions":
        setVersionsOpen(true);
        break;
      case "checkout":
        void toggleLock();
        break;
      case "translate":
        translated.current = null;
        setTranslateOpen(true);
        break;
      case "ask":
        ask("", false);
        break;
      case "summarize":
        ask("Summarize this document: the main points, the people or companies involved, key dates and amounts, and anything that needs action.", true);
        break;
      case "extract-data":
        toAssistant("extract");
        break;
      case "read":
        if (tts) setTts(false);
        else if (requirePro("Read PDF")) setTts(true);
        break;
    }
  };
  actionRef.current = run;

  // Tools picked in the top search run here.
  useEffect(() => {
    const onRun = (e: Event) => actionRef.current?.((e as CustomEvent<{ key: string }>).detail.key);
    window.addEventListener("pdftek:run", onRun);
    return () => window.removeEventListener("pdftek:run", onRun);
  }, []);

  const trashDoc = async () => {
    if (!active || !confirm(`Move “${active.name}” to trash?`)) return;
    try {
      await api(`/api/documents/${active.id}`, { method: "DELETE" });
      toast("Moved to trash");
      openDoc(null);
      void reloadDocs();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  /** Fits the page to the width available (the button; or automatically while the user hasn't zoomed). */
  const autoFit = useRef(true);
  const fit = useCallback(
    async (max = 3) => {
      if (!pdf || !scrollRef.current) return;
      const p = await pdf.getPage(1);
      const w = p.getViewport({ scale: 1 }).width;
      const avail = scrollRef.current.clientWidth - 48;
      if (avail > 100) setScale(Math.max(0.4, Math.min(max, +(avail / w).toFixed(2))));
    },
    [pdf],
  );
  const zoom = (d: number) => {
    autoFit.current = false;
    setScale((s) => Math.max(0.4, Math.min(3, +(s + d).toFixed(2))));
  };
  // Opening or closing a side panel (or resizing the window) refits the page until the user zooms.
  useEffect(() => {
    if (!pdf) return;
    const t = setTimeout(() => autoFit.current && void fit(1.5), 60);
    const onResize = () => autoFit.current && void fit(1.5);
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [pdf, fit, aiOpen, toolsOpen, pagesOpen, editing]);

  const print = () => {
    const w = window.open(src, "_blank");
    w?.addEventListener("load", () => w.print());
  };

  const formatsMenu =
    formatsOpen && active
      ? {
          key: "convert-more",
          node: (
            <Menu open onClose={() => setFormatsOpen(false)}>
              <div className="menu-label">All {active.pageCount} pages</div>
              <button className="menu-item" onClick={() => convert("webp")}>WEBP <span className="sub">smaller images</span></button>
              <button className="menu-item" onClick={() => convert("tiff")}>TIFF <span className="sub">print / archival</span></button>
              <button className="menu-item" onClick={() => convert("txt")}>Plain text (.txt)</button>
              <div className="menu-label">This page only (p.{page})</div>
              <div className="row gap-4" style={{ padding: "2px 8px 8px" }}>
                {(["jpg", "png", "webp", "tiff"] as const).map((f) => (
                  <button key={f} className="chip" onClick={() => convert(f, [page])}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </Menu>
          ),
        }
      : null;
  const labels = { checkout: lockedByMe ? "Check in" : "Check out", read: tts ? "Stop reading" : "Read PDF" };
  const toolsPanel = (onClose?: () => void) => (
    <ToolsPanel
      run={(k) => {
        if (onClose && k !== "convert-more") onClose();
        run(k);
      }}
      member={member}
      hasDoc={!!active}
      ready={!!pdf}
      labels={labels}
      menu={formatsMenu}
      current={editing ? "edit" : tts ? "read" : null}
      onClose={onClose}
    />
  );

  const modals = (
    <>
      {toolModal && (
        <ToolModal
          wid={wid}
          tool={toolModal}
          docs={docs}
          preselect={active?.id ?? null}
          fixedDoc={!!active && toolModal !== "merge"}
          onUploaded={(list) => list.forEach(upsertDoc)}
          onOpen={(id) => openDoc(id)}
          onClose={() => setToolModal(null)}
        />
      )}
      {toPdf && <ConvertToPdfModal wid={wid} onClose={() => setToPdf(false)} />}
      {cloudSave && active && <SaveToCloudModal documentId={active.id} name={active.name} onClose={() => setCloudSave(false)} />}
      {translateOpen && active && (
        <TranslateModal
          doc={active}
          billing={info.billing}
          onCreated={(d) => {
            upsertDoc(d);
            translated.current = d.id;
          }}
          onClose={() => {
            setTranslateOpen(false);
            if (translated.current) openDoc(translated.current);
          }}
        />
      )}
      {unlock && (
        <UnlockModal
          wid={wid}
          onUploaded={(list) => {
            list.forEach(upsertDoc);
            if (list[0]) openDoc(list[0].id);
          }}
          onClose={() => setUnlock(false)}
        />
      )}
    </>
  );


  if (!active) {
    return (
      <>
        <Home run={run} />
        {aiOpen && <Assistant />}
        {modals}
      </>
    );
  }

  const shareLink = async () => {
    const url = `${window.location.origin}/app/${wid}?doc=${active.id}`;
    try {
      if (navigator.share && window.innerWidth <= 960) await navigator.share({ title: active.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied. Teammates in this workspace can open it.", "success");
      }
    } catch {}
  };
  const showRail = aiOpen && !editing;

  return (
    <section className="viewer wb-doc">
      <header className="wb-dtop">
        <button className="wb-ibtn" onClick={() => openDoc(null)} aria-label="Back to home" title="Back to home">
          <I.back size={20} />
        </button>
        <button className={`wb-ibtn hide-mobile ${toolsOpen && !showRail ? "on" : ""}`} onClick={() => (showRail ? closeAI() : setPref("tools", !toolsOpen))} aria-label="All tools" title="All tools" disabled={!!editing}>
          <I.tools size={18} />
        </button>
        <div className="wb-fname">
          <FileBadge type={active.sourceType} />
          <div className="wb-fname-text">
            <b className="ellipsis" title={active.name}>{active.name}</b>
            <span className="ellipsis">
              Saved · {active.pageCount} {active.pageCount === 1 ? "page" : "pages"} · {bytes(active.size)} · updated {timeAgo(active.updatedAt)}
              {active.assignedTo && <> · assigned to {active.assignedTo.id === me ? "you" : active.assignedTo.name}</>}
            </span>
          </div>
          {lockedByMe && (
            <span className="badge badge-warn hide-mobile">
              <I.lock size={10} /> checked out by you
            </span>
          )}
        </div>
        <span className="grow" />
        <div className="menu-wrap hide-mobile">
          <button className={`wb-ibtn ${findOpen ? "on" : ""}`} onClick={() => setFindOpen((v) => !v)} aria-label="Search" title="Search documents, tools, or ask (/)">
            <I.search size={19} />
          </button>
          {findOpen && (
            <div className="wb-dsearch">
              <GlobalSearch autoFocus onDone={() => setFindOpen(false)} />
            </div>
          )}
        </div>
        <button className={`wb-btn ${aiOpen ? "tonal" : "askai"} hide-mobile`} onClick={() => (aiOpen ? closeAI() : openAI())} aria-pressed={aiOpen}>
          <I.sparkle size={16} /> Ask AI
        </button>
        <button className="wb-btn hide-mobile wb-hide-md" onClick={() => run("sign")} title="Send for e-signature">
          <I.sign size={16} /> Request signature
        </button>
        <a className="wb-btn filled" href={`/api/documents/${active.id}/file?download=1`} title="Download the latest version as PDF">
          <I.download size={16} /> <span className="hide-mobile">Download</span>
        </a>
        <button className="wb-ibtn hide-mobile" onClick={shareLink} aria-label="Copy link" title="Copy a link for teammates">
          <I.share size={18} />
        </button>
        <div className="menu-wrap">
          <button className="wb-ibtn" onClick={() => setMoreOpen((v) => !v)} aria-label="More actions">
            <I.more size={18} />
          </button>
          <Menu open={moreOpen} onClose={() => setMoreOpen(false)}>
            <button className="menu-item show-mobile" onClick={() => { setMoreOpen(false); run("sign"); }}>
              <I.sign size={14} /> Request signature
            </button>
            <button className="menu-item show-mobile" onClick={() => { setMoreOpen(false); void shareLink(); }}>
              <I.share size={14} /> Share link
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); setRenaming(true); }}>
              <I.edit size={14} /> Rename
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); setTagging(true); }}>
              <I.tag size={14} /> Tags
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); setVersionsOpen(true); }}>
              <I.history size={14} /> Version history
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); setHandoffOpen(true); }} disabled={lockedByOther}>
              <I.swap size={14} /> Hand off to a teammate
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); void toggleLock(); }} disabled={lockedByOther && info.role === "member"}>
              {lockedByMe ? <I.unlock size={14} /> : <I.lock size={14} />} {lockedByMe ? "Check in" : "Check out (lock editing)"}
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); setCloudSave(true); }}>
              <I.folder size={14} /> Save to cloud
            </button>
            <button className="menu-item" onClick={() => { setMoreOpen(false); print(); }}>
              <I.file size={14} /> Print
            </button>
            <Link className="menu-item" href={`/app/${wid}/tools?doc=${active.id}`}>
              <I.tools size={14} /> All tools
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
            <div className="menu-sep" />
            <button className="menu-item" style={{ color: "var(--bad)" }} onClick={() => { setMoreOpen(false); void trashDoc(); }}>
              <I.trash size={14} /> Move to trash
            </button>
          </Menu>
        </div>
        <span className="wb-dtop-sep hide-mobile" />
        <span className="wb-dtop-account hide-mobile">
          <AccountButtons />
        </span>
      </header>

      {lockedByOther && (
        <div className="notice wb-notice">
          <I.lock size={14} /> {active.checkedOutBy?.name} has this document checked out {active.checkedOutAt ? timeAgo(active.checkedOutAt) : ""}. You can read, chat and extract; edits are paused until it’s checked in or handed to you.
        </div>
      )}
      {active.scanned && !editing && (
        <div className="notice notice-info wb-notice">
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

      <div className="wb-dbody">
        {!editing && showRail && (
          <nav className="wb-rail hide-mobile" aria-label="Tools">
            <button className="wb-ri" onClick={() => { closeAI(); setPref("tools", true); }}>
              <span className="wb-pill"><I.tools size={20} /></span>Tools
            </button>
            <button className={`wb-ri ${pagesOpen ? "on" : ""}`} onClick={() => setPref("pages", !pagesOpen)}>
              <span className="wb-pill"><I.pages size={20} /></span>Pages
            </button>
            <button className={`wb-ri ${findOpen ? "on" : ""}`} onClick={() => setFindOpen(true)}>
              <span className="wb-pill"><I.search size={20} /></span>Find
            </button>
            <button className="wb-ri" onClick={() => run("edit")}>
              <span className="wb-pill"><I.edit size={20} /></span>Edit
            </button>
            <button className="wb-ri" onClick={() => run("sign")}>
              <span className="wb-pill"><I.sign size={20} /></span>Sign
            </button>
          </nav>
        )}
        {!editing && !showRail && toolsOpen && <div className="wb-tools-wrap hide-mobile">{toolsPanel()}</div>}
        {!editing && pagesOpen && (
          <div className="wb-pages-wrap hide-mobile">
            <PageRail pdf={pdf} page={page} onPick={(n) => jump(n)} />
          </div>
        )}
        <div className="wb-canvas">
          {editing ? (
            <Editor
              doc={active}
              initialTool={editing}
              onExit={(saved) => {
                setEditing(null);
                if (saved) {
                  forgetPdf(src);
                  upsertDoc(saved);
                }
              }}
            />
          ) : (
            <>
              <div className="page-scroll" ref={scrollRef}>
                <PdfViewer src={src} scale={scale} flash={flash} onLoaded={onLoaded} onVisiblePage={setPage} scrollRef={scrollRef} onError={(e) => toast(e.message, "error")} />
              </div>
              {!tts && (
                <div className="viewer-float wb-pctrl">
                  <button className={`wb-ibtn sm hide-mobile ${pagesOpen ? "on" : ""}`} onClick={() => setPref("pages", !pagesOpen)} aria-label="Page thumbnails" title="Page thumbnails" aria-pressed={pagesOpen}>
                    <I.pages size={16} />
                  </button>
                  <button className="wb-ibtn sm" onClick={() => zoom(-0.15)} aria-label="Zoom out">
                    <I.zoomOut size={16} />
                  </button>
                  <span className="wb-pct">{Math.round(scale * 100)}%</span>
                  <button className="wb-ibtn sm" onClick={() => zoom(0.15)} aria-label="Zoom in">
                    <I.zoomIn size={16} />
                  </button>
                  <span className="wb-vsep" />
                  <span className="wb-pno">
                    {page} / {active.pageCount}
                  </span>
                  <button className="wb-ibtn sm" onClick={() => { autoFit.current = true; void fit(); }} aria-label="Fit to width" title="Fit to width">
                    <I.fit size={16} />
                  </button>
                </div>
              )}
              {tts && <ReadAloud doc={active} startPage={page} onClose={() => setTts(false)} />}
            </>
          )}
        </div>
        {aiOpen && <Assistant />}
      </div>

      {!editing && (
        <div className="wb-phbar show-mobile">
          <button className="wb-btn tonal" onClick={() => setSheet("tools")}>
            <I.tools size={16} /> Tools
          </button>
          <button className="wb-btn askai" onClick={() => openAI()}>
            <I.sparkle size={16} /> Ask AI
          </button>
        </div>
      )}
      {sheet && (
        <div className="wb-sheet-back show-mobile" onClick={() => setSheet(null)}>
          <div className={`wb-sheet ${sheet === "all" ? "tall" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tools">
            <div className="wb-grab" />
            {sheet === "tools" ? (
              <div className="wb-sgrid">
                <button onClick={() => { setSheet(null); openAI(); }}>
                  <ToolArt act={{ key: "ask", label: "", icon: null, hint: "" }} size={40} />
                  Ask AI
                </button>
                {PHONE_TOOLS.map((k) => {
                  const a = ACTS.find((x) => x.key === k)!;
                  return (
                    <button key={k} onClick={() => { setSheet(null); run(k); }}>
                      <ToolArt act={a} size={40} />
                      {labels[k as keyof typeof labels] ?? a.label}
                    </button>
                  );
                })}
                <button onClick={() => setSheet("all")}>
                  <span className="wb-art wb-art-plain" style={{ width: 40, height: 40 }}>
                    <I.grid size={20} />
                  </span>
                  All tools
                </button>
              </div>
            ) : (
              toolsPanel(() => setSheet(null))
            )}
          </div>
        </div>
      )}
      {renaming && <RenameModal doc={active} onClose={() => setRenaming(false)} />}
      {tagging && <TagModal doc={active} onClose={() => setTagging(false)} suggestions={[...new Set(docs.flatMap((d) => d.tags))].sort()} />}
      {versionsOpen && <VersionsModal doc={active} onClose={() => setVersionsOpen(false)} />}
      {handoffOpen && <HandOffModal doc={active} onClose={() => setHandoffOpen(false)} />}
      {ocrOpen && pdf && <OcrModal doc={active} pdf={pdf} onClose={() => setOcrOpen(false)} />}
      {modals}
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
