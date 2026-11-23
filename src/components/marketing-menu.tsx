"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "./icons";
import { useLocalePath, useT } from "./i18n";

type Item = {
  href: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  tag?: string;
};
type Group = { title: string; items: Item[] };

const FMT = (t: string, c: string) => (
  <span className="fmt-chip" style={{ background: c }}>
    {t}
  </span>
);

const CONVERT: Group[] = [
  {
    title: "Convert to PDF",
    items: [
      {
        href: "/go/word-to-pdf",
        label: "Word to PDF",
        icon: FMT("DOC", "#2f6fd6"),
      },
      {
        href: "/go/excel-to-pdf",
        label: "Excel to PDF",
        icon: FMT("XLS", "#2a8a4f"),
      },
      {
        href: "/go/powerpoint-to-pdf",
        label: "PowerPoint to PDF",
        icon: FMT("PPT", "#d0642b"),
      },
      {
        href: "/go/jpg-to-pdf",
        label: "JPG to PDF",
        icon: FMT("JPG", "#8a5cd6"),
      },
      {
        href: "/go/to-pdf",
        label: "TIFF to PDF",
        icon: FMT("TIF", "#5c7cd6"),
      },
      {
        href: "/go/scan-to-pdf",
        label: "Scan to PDF",
        sub: "Use your camera",
        icon: <I.camera size={15} />,
      },
    ],
  },
  {
    title: "Convert from PDF",
    items: [
      {
        href: "/go/pdf-to-word",
        label: "PDF to Word",
        icon: FMT("DOC", "#2f6fd6"),
      },
      {
        href: "/go/pdf-to-excel",
        label: "PDF to Excel",
        icon: FMT("XLS", "#2a8a4f"),
      },
      {
        href: "/go/bank-statement-to-excel",
        label: "Bank statement to Excel",
        icon: FMT("XLS", "#2a8a4f"),
      },
      {
        href: "/go/invoice-to-excel",
        label: "Invoice to Excel",
        icon: FMT("XLS", "#2a8a4f"),
      },
      {
        href: "/go/bulk-convert",
        label: "Bulk convert",
        sub: "Many PDFs at once",
        icon: <I.layers size={15} />,
      },
      {
        href: "/go/pdf-to-powerpoint",
        label: "PDF to PowerPoint",
        icon: FMT("PPT", "#d0642b"),
      },
      {
        href: "/go/pdf-to-jpg",
        label: "PDF to JPG",
        icon: FMT("JPG", "#8a5cd6"),
      },
      {
        href: "/go/ocr",
        label: "OCR",
        sub: "Make scans searchable",
        icon: <I.scan size={15} />,
      },
    ],
  },
];

const ORGANIZE: Group[] = [
  {
    title: "Pages",
    items: [
      { href: "/go/merge", label: "Merge PDFs", icon: <I.merge size={15} /> },
      { href: "/go/split", label: "Split PDF", icon: <I.split size={15} /> },
      {
        href: "/go/organize",
        label: "Organize pages",
        sub: "Reorder, rotate, delete",
        icon: <I.layers size={15} />,
      },
      { href: "/go/rotate", label: "Rotate", icon: <I.rotate size={15} /> },
    ],
  },
  {
    title: "Finish",
    items: [
      {
        href: "/go/compress",
        label: "Compress",
        icon: <I.zoomOut size={15} />,
      },
      { href: "/go/watermark", label: "Watermark", icon: <I.drop size={15} /> },
      {
        href: "/go/page-numbers",
        label: "Page numbers",
        icon: <I.hash size={15} />,
      },
      {
        href: "/go/compare",
        label: "Compare",
        sub: "Redline two versions",
        icon: <I.compare size={15} />,
      },
    ],
  },
  {
    title: "Secure",
    items: [
      { href: "/go/protect", label: "Protect PDF", sub: "Add a password", icon: <I.lock size={15} /> },
      { href: "/go/unlock", label: "Unlock PDF", sub: "Remove a password", icon: <I.unlock size={15} /> },
      { href: "/request-documents", label: "Request documents", sub: "Collect files with a protected link", icon: <I.inbox size={15} /> },
    ],
  },
];

const SIGN: Group[] = [
  {
    title: "E-signatures",
    items: [
      { href: "/go/sign", label: "Request signatures", sub: "Send a PDF to be signed", icon: <I.sign size={15} /> },
      { href: "/go/esign-templates", label: "Templates & bulk send", sub: "Reuse a document, send to many", icon: <I.copy size={15} />, tag: "New" },
      { href: "/go/signing-links", label: "Signing links", sub: "Anyone can sign, and pay", icon: <I.link size={15} />, tag: "New" },
    ],
  },
  {
    title: "Forms",
    items: [
      { href: "/go/fill-form", label: "Fill a form", sub: "AI fills it, you sign", icon: <I.form size={15} /> },
      { href: "/request-documents", label: "Request documents", sub: "Collect files with a protected link", icon: <I.inbox size={15} /> },
    ],
  },
];

const AI: Group[] = [
  {
    title: "AI tools",
    items: [
      { href: "/go/translate", label: "Translate PDF", sub: "35+ languages, layout kept", icon: <I.globe size={15} />, tag: "New" },
      { href: "/go/read-aloud", label: "Read PDF", sub: "Listen in 11 languages", icon: <I.speaker size={15} /> },
      { href: "/go/ask", label: "Ask AI about a PDF", sub: "Answers cite the page", icon: <I.chat size={15} /> },
      { href: "/go/fill-form", label: "Fill forms with AI", sub: "Even scanned forms", icon: <I.form size={15} /> },
      { href: "/go/compare", label: "Compare documents", sub: "Redline with an AI summary", icon: <I.compare size={15} /> },
    ],
  },
];

type Entry = {
  label: string;
  href?: string;
  groups?: Group[];
  /** Shown in the phone menu; in the top bar only on the accent entry (Ask AI). */
  icon: React.ReactNode;
  accent?: boolean;
  /** Wider menu columns (longer item names). */
  roomy?: boolean;
};
const ENTRIES: Entry[] = [
  { label: "Convert", groups: CONVERT, icon: <I.convert size={18} /> },
  { label: "Edit", href: "/go/edit", icon: <I.edit size={18} /> },
  { label: "Fill form", href: "/go/fill-form", icon: <I.form size={18} /> },
  { label: "Sign", groups: SIGN, icon: <I.sign size={18} />, roomy: true },
  { label: "Organize", groups: ORGANIZE, icon: <I.layers size={18} /> },
  // "Ask AI" opens the chat when clicked, and shows every AI tool (Translate PDF, Read PDF…) on hover.
  {
    label: "Ask AI",
    href: "/go/ask",
    groups: AI,
    icon: <I.sparkle size={18} />,
    accent: true,
    roomy: true,
  },
];

/** A label with a "New" marker that stays on the same line as the label's last word. */
function Tagged({ label, tag }: { label: string; tag: string }) {
  const words = label.split(" ");
  const last = words.pop();
  return (
    <>
      {words.length ? `${words.join(" ")} ` : ""}
      <span style={{ whiteSpace: "nowrap" }}>
        {last}
        <span className="mega-tag">{tag}</span>
      </span>
    </>
  );
}

function Panel({ groups, onPick, roomy }: { groups: Group[]; onPick: () => void; roomy?: boolean }) {
  const t = useT();
  const lp = useLocalePath();
  return (
    <div className={`mega-cols ${roomy ? "roomy" : ""}`}>
      {groups.map((g) => (
        <div key={g.title} className="mega-col">
          <div className="mega-title">{t(g.title)}</div>
          {g.items.map((it) => (
            <Link prefetch={false} key={it.href + it.label} href={it.href.startsWith("/go/") ? it.href : lp(it.href)} className="mega-item" onClick={onPick}>
              <span className="mega-ico">{it.icon}</span>
              <span className="col" style={{ gap: 0 }}>
                <span>{it.tag ? <Tagged label={t(it.label)} tag={t(it.tag)} /> : t(it.label)}</span>
                {it.sub && <span className="mega-sub">{t(it.sub)}</span>}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Desktop: six entries, four with hover/click mega-menus. Mobile: one "Tools" sheet with every
 * section. Languages whose labels don't fit in the top bar get the menu button on desktop too.
 */
export function MarketingMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const t = useT();
  const lp = useLocalePath();

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(null), setSheet(false));
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
  }, [sheet]);

  // Long translations (Spanish, German…) can make the full menu wider than the bar. Measure it at
  // full size: if it doesn't fit, tighten the spacing; if that still doesn't fit, use the menu button.
  useEffect(() => {
    const links = ref.current;
    const bar = links?.parentElement;
    if (!links || !bar) return;
    const need = { normal: 0, dense: 0 };
    const measure = () => {
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      const kids = [...bar.children].filter((k) => getComputedStyle(k).display !== "none" && !k.classList.contains("grow"));
      return kids.reduce((w, k) => w + (k === links ? links.scrollWidth : k.getBoundingClientRect().width), 0) + gap * (kids.length - 1);
    };
    const check = () => {
      if (!need.normal) {
        bar.classList.remove("mk-compact", "mk-dense");
        if (getComputedStyle(links).display === "none") return; // phone or tablet layout: nothing to measure yet
        need.normal = measure();
        bar.classList.add("mk-dense");
        need.dense = measure();
        bar.classList.remove("mk-dense");
      }
      const room = bar.clientWidth - parseFloat(getComputedStyle(bar).paddingLeft) - parseFloat(getComputedStyle(bar).paddingRight);
      bar.classList.toggle("mk-dense", need.normal > room && need.dense <= room);
      bar.classList.toggle("mk-compact", need.dense > room);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    // Text widths change once the web fonts arrive: measure again then.
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      need.normal = 0;
      check();
    });
    return () => {
      live = false;
      ro.disconnect();
    };
  }, []);

  const enter = (label: string) => {
    clearTimeout(timer.current);
    setOpen(label);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(null), 160);
  };

  return (
    <>
      <div className="mk-links" ref={ref}>
        {ENTRIES.map((e) =>
          e.groups && e.href ? (
            <div key={e.label} className="mk-drop" onMouseEnter={() => enter(e.label)} onMouseLeave={leave} onFocus={() => enter(e.label)} onBlur={leave}>
              <Link prefetch={false} href={e.href} className={`mk-link ${e.accent ? "accent" : ""} ${open === e.label ? "on" : ""}`} aria-haspopup="true" aria-expanded={open === e.label}>
                {e.accent && e.icon} {t(e.label)} <I.chevron size={13} />
              </Link>
              {open === e.label && (
                <div className="mega" role="menu">
                  <Panel groups={e.groups} roomy={e.roomy} onPick={() => setOpen(null)} />
                </div>
              )}
            </div>
          ) : e.groups ? (
            <div key={e.label} className="mk-drop" onMouseEnter={() => enter(e.label)} onMouseLeave={leave}>
              <button
                className={`mk-link ${open === e.label ? "on" : ""}`}
                aria-expanded={open === e.label}
                onClick={() => setOpen(open === e.label ? null : e.label)}
              >
                {t(e.label)} <I.chevron size={13} />
              </button>
              {open === e.label && (
                <div className="mega" role="menu">
                  <Panel groups={e.groups} roomy={e.roomy} onPick={() => setOpen(null)} />
                </div>
              )}
            </div>
          ) : (
            <Link prefetch={false} key={e.label} href={e.href!} className={`mk-link ${e.accent ? "accent" : ""}`}>
              {e.accent && e.icon} {t(e.label)}
            </Link>
          ),
        )}
      </div>

      <button className="mk-burger" aria-label={t("Open tools menu")} onClick={() => setSheet(true)}>
        <I.menu size={18} />
      </button>
      {sheet &&
        createPortal(
          <div className="mk-sheet" role="dialog" aria-label={t("Tools")}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <b>{t("Tools")}</b>
              <button className="icon-btn" aria-label={t("Close")} onClick={() => setSheet(false)}>
                <I.x size={18} />
              </button>
            </div>
            <div className="mk-sheet-quick">
              {ENTRIES.filter((e) => e.href).map((e) => (
                <Link prefetch={false} key={e.label} href={e.href!} className={`mk-quick ${e.accent ? "accent" : ""}`} onClick={() => setSheet(false)}>
                  {e.icon} {t(e.label)}
                </Link>
              ))}
            </div>
            <Panel groups={[...SIGN, ...AI, ...CONVERT, ...ORGANIZE]} onPick={() => setSheet(false)} />
            <div className="row gap-16 wrap small" style={{ marginTop: 16 }}>
              <Link href={lp("/pricing")} onClick={() => setSheet(false)}>{t("Pricing")}</Link>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
