"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "../icons";

/**
 * The workbench's tool ribbon: every tool, grouped into tabs, one click away. It is always shown,
 * even before the first upload; a tool picked with no document open asks for the file first and
 * then runs on it.
 */

export type Act = {
  key: string;
  label: string;
  icon: React.ReactNode;
  hint: string;
  /** Needs a Day Pass / Pro / Team. */
  pro?: boolean;
  /** Uses AI credits. */
  ai?: boolean;
  /** Works without an open document (starts from an upload or the library). */
  noDoc?: boolean;
};

export const RIBBON: { key: string; label: string; acts: Act[] }[] = [
  {
    key: "convert",
    label: "Convert",
    acts: [
      { key: "convert-docx", label: "To Word", icon: <I.file size={18} />, hint: "Editable Word document (.docx)" },
      { key: "convert-xlsx", label: "To Excel", icon: <I.table size={18} />, hint: "Tables become spreadsheet cells (.xlsx)" },
      { key: "convert-pptx", label: "To PowerPoint", icon: <I.layers size={18} />, hint: "One slide per page (.pptx)" },
      { key: "convert-jpg", label: "To JPG", icon: <I.image size={18} />, hint: "Every page as a JPG image" },
      { key: "convert-png", label: "To PNG", icon: <I.image size={18} />, hint: "Every page as a PNG image" },
      { key: "convert-more", label: "More formats", icon: <I.more size={18} />, hint: "WEBP, TIFF, plain text, or just this page" },
      { key: "statement", label: "Statement → Excel", icon: <I.table size={18} />, hint: "Bank or card transactions, checked against balances", ai: true },
      { key: "invoice", label: "Invoice → Excel", icon: <I.file size={18} />, hint: "Vendor, line items, tax and totals", ai: true },
      { key: "topdf", label: "Files → PDF", icon: <I.upload size={18} />, hint: "Word, Excel, PowerPoint, text or TIFF to PDF", noDoc: true },
      { key: "images", label: "Images → PDF", icon: <I.image size={18} />, hint: "Combine photos into one PDF", noDoc: true },
      { key: "scan", label: "Scan", icon: <I.camera size={18} />, hint: "Use your camera, with auto-crop", noDoc: true },
      { key: "ocr", label: "OCR", icon: <I.scan size={18} />, hint: "Make a scan searchable and copyable" },
    ],
  },
  {
    key: "edit",
    label: "Edit",
    acts: [
      { key: "edit", label: "Edit text & images", icon: <I.edit size={18} />, hint: "Change text, move and add images", pro: true },
      { key: "edit-text", label: "Add text", icon: <I.text size={18} />, hint: "Type anywhere on the page", pro: true },
      { key: "edit-mark", label: "Highlight", icon: <I.highlight size={18} />, hint: "Highlight, underline or strike out", pro: true },
      { key: "edit-ink", label: "Draw", icon: <I.pencil size={18} />, hint: "Pen, marker and shapes", pro: true },
      { key: "redact", label: "Redact", icon: <I.redact size={18} />, hint: "Permanently remove sensitive content", pro: true },
      { key: "watermark", label: "Watermark", icon: <I.drop size={18} />, hint: "Stamp DRAFT, CONFIDENTIAL or any text" },
      { key: "page_numbers", label: "Page numbers", icon: <I.hash size={18} />, hint: "“Page 1 of 10” or Bates numbering" },
      { key: "metadata", label: "Properties", icon: <I.tag size={18} />, hint: "Title, author and subject" },
    ],
  },
  {
    key: "organize",
    label: "Organize",
    acts: [
      { key: "organize", label: "Organize pages", icon: <I.layers size={18} />, hint: "Reorder, rotate or delete pages visually" },
      { key: "merge", label: "Merge", icon: <I.merge size={18} />, hint: "Combine documents into one", noDoc: true },
      { key: "split", label: "Split", icon: <I.split size={18} />, hint: "Break into parts by page ranges" },
      { key: "extract", label: "Extract pages", icon: <I.copy size={18} />, hint: "Copy pages into a new document" },
      { key: "delete_pages", label: "Delete pages", icon: <I.trash size={18} />, hint: "Remove pages and save a new version" },
      { key: "rotate", label: "Rotate", icon: <I.rotate size={18} />, hint: "Turn pages 90° or 180°" },
      { key: "optimize", label: "Compress", icon: <I.zoomOut size={18} />, hint: "Make the file smaller" },
      { key: "compare", label: "Compare", icon: <I.compare size={18} />, hint: "Redline two documents or versions" },
    ],
  },
  {
    key: "sign",
    label: "Fill & sign",
    acts: [
      { key: "fill", label: "Fill form", icon: <I.form size={18} />, hint: "AI finds every field and fills it from your profile", ai: true },
      { key: "sign", label: "Request signatures", icon: <I.sign size={18} />, hint: "Send for e-signature with reminders", pro: true },
      { key: "request", label: "Request documents", icon: <I.inbox size={18} />, hint: "Collect files with a secure link", pro: true, noDoc: true },
      { key: "handoff", label: "Hand off", icon: <I.swap size={18} />, hint: "Assign the document to a teammate" },
    ],
  },
  {
    key: "protect",
    label: "Protect",
    acts: [
      { key: "protect", label: "Add password", icon: <I.lock size={18} />, hint: "Encrypt with AES-256 and set permissions" },
      { key: "unlock", label: "Remove password", icon: <I.unlock size={18} />, hint: "Unlock a PDF you can open", noDoc: true },
      { key: "redact", label: "Redact", icon: <I.redact size={18} />, hint: "Permanently remove sensitive content", pro: true },
      { key: "versions", label: "Version history", icon: <I.history size={18} />, hint: "See and restore earlier versions" },
      { key: "checkout", label: "Check out", icon: <I.lock size={18} />, hint: "Lock editing while you work on it" },
    ],
  },
  {
    key: "ai",
    label: "AI tools",
    acts: [
      { key: "ask", label: "Ask a question", icon: <I.chat size={18} />, hint: "Answers cite the page they came from", ai: true },
      { key: "summarize", label: "Summarize", icon: <I.sparkle size={18} />, hint: "Key points in a few lines", ai: true },
      { key: "extract-data", label: "Extract data", icon: <I.table size={18} />, hint: "Pull tables and key terms into a sheet", ai: true },
      { key: "read", label: "Read aloud", icon: <I.speaker size={18} />, hint: "Listen in 11 languages", pro: true },
      { key: "fill", label: "Fill form", icon: <I.form size={18} />, hint: "AI fills forms from your profile", ai: true },
    ],
  },
];

const ALL: Act[] = RIBBON.flatMap((t) => t.acts).filter((a, i, list) => list.findIndex((b) => b.key === a.key) === i);
export const needsDoc = (key: string) => !ALL.find((a) => a.key === key)?.noDoc;

const TAB_KEY = "pdftek-ribbon-tab";

export function Ribbon({
  run,
  member,
  hasDoc,
  ready,
  labels = {},
  menu,
}: {
  run: (key: string, el?: HTMLElement) => void;
  member: boolean;
  hasDoc: boolean;
  /** The open PDF has loaded (in-browser conversions need it). */
  ready: boolean;
  /** Labels that depend on state, e.g. "Check in". */
  labels?: Record<string, string>;
  /** A dropdown to show under a button (rendered by the parent), keyed by action. */
  menu?: { key: string; node: React.ReactNode } | null;
}) {
  const [tab, setTab] = useState("convert");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved && RIBBON.some((t) => t.key === saved)) setTab(saved);
    } catch {}
  }, []);
  const pick = (k: string) => {
    setTab(k);
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {}
  };

  // "/" focuses tool search, like most professional apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ALL.filter((a) => `${a.label} ${a.hint} ${a.key}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const current = RIBBON.find((t) => t.key === tab) ?? RIBBON[0];
  const button = (a: Act) => {
    const disabled = hasDoc && !ready && a.key.startsWith("convert-");
    return (
      <div key={a.key} className="menu-wrap">
        <button className="rb-btn" title={a.hint} disabled={disabled} onClick={(e) => run(a.key, e.currentTarget)}>
          <span className="rb-ico">{a.icon}</span>
          <span className="rb-label">{labels[a.key] ?? a.label}</span>
          {a.pro && !member && <span className="pro-tag">PRO</span>}
          {a.ai && <span className="rb-ai" title="Uses AI credits">AI</span>}
        </button>
        {menu?.key === a.key && menu.node}
      </div>
    );
  };

  return (
    <div className="ribbon">
      <div className="rb-head">
        <div className="rb-tabs" role="tablist" aria-label="Tools">
          {RIBBON.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === tab} className={`rb-tab ${t.key === tab ? "on" : ""}`} onClick={() => pick(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="rb-search">
          <I.search size={13} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                run(results[0].key);
                setQuery("");
              } else if (e.key === "Escape") setQuery("");
            }}
            placeholder="Find a tool…"
            aria-label="Find a tool"
          />
          <kbd className="hide-mobile">/</kbd>
          {focus && results.length > 0 && (
            <div className="rb-results" role="listbox">
              {results.map((a) => (
                <button
                  key={a.key}
                  role="option"
                  aria-selected={false}
                  className="menu-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    run(a.key);
                    setQuery("");
                  }}
                >
                  {a.icon}
                  <span className="grow">
                    {a.label}
                    <span className="tiny faint" style={{ display: "block" }}>
                      {a.hint}
                    </span>
                  </span>
                  {a.pro && !member && <span className="pro-tag">PRO</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="rb-body" role="tabpanel" aria-label={current.label}>
        {current.acts.map(button)}
      </div>
    </div>
  );
}
