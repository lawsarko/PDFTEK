"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "./icons";

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
];

type Entry = {
  label: string;
  href?: string;
  groups?: Group[];
  icon: React.ReactNode;
  accent?: boolean;
};
const ENTRIES: Entry[] = [
  { label: "Convert", groups: CONVERT, icon: <I.convert size={14} /> },
  { label: "Edit", href: "/go/edit", icon: <I.edit size={14} /> },
  { label: "Sign", href: "/go/sign", icon: <I.sign size={14} /> },
  { label: "Organize", groups: ORGANIZE, icon: <I.layers size={14} /> },
  {
    label: "Ask AI",
    href: "/go/ask",
    icon: <I.sparkle size={14} />,
    accent: true,
  },
];

function Panel({ groups, onPick }: { groups: Group[]; onPick: () => void }) {
  return (
    <div className="mega-cols">
      {groups.map((g) => (
        <div key={g.title} className="mega-col">
          <div className="mega-title">{g.title}</div>
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} className="mega-item" onClick={onPick}>
              <span className="mega-ico">{it.icon}</span>
              <span className="col" style={{ gap: 0 }}>
                <span>{it.label}</span>
                {it.sub && <span className="mega-sub">{it.sub}</span>}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Desktop: five entries, two with hover/click mega-menus. Mobile: one "Tools" sheet. */
export function MarketingMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
          e.groups ? (
            <div key={e.label} className="mk-drop" onMouseEnter={() => enter(e.label)} onMouseLeave={leave}>
              <button
                className={`mk-link ${open === e.label ? "on" : ""}`}
                aria-expanded={open === e.label}
                onClick={() => setOpen(open === e.label ? null : e.label)}
              >
                {e.icon} {e.label} <I.chevron size={12} />
              </button>
              {open === e.label && (
                <div className="mega" role="menu">
                  <Panel groups={e.groups} onPick={() => setOpen(null)} />
                </div>
              )}
            </div>
          ) : (
            <Link key={e.label} href={e.href!} className={`mk-link ${e.accent ? "accent" : ""}`}>
              {e.icon} {e.label}
            </Link>
          ),
        )}
      </div>

      <button className="mk-burger" aria-label="Open tools menu" onClick={() => setSheet(true)}>
        <I.menu size={18} />
      </button>
      {sheet &&
        createPortal(
          <div className="mk-sheet" role="dialog" aria-label="Tools">
            <div className="row between" style={{ marginBottom: 12 }}>
              <b>Tools</b>
              <button className="icon-btn" aria-label="Close" onClick={() => setSheet(false)}>
                <I.x size={18} />
              </button>
            </div>
            <div className="mk-sheet-quick">
              {ENTRIES.filter((e) => e.href).map((e) => (
                <Link key={e.label} href={e.href!} className={`mk-quick ${e.accent ? "accent" : ""}`} onClick={() => setSheet(false)}>
                  {e.icon} {e.label}
                </Link>
              ))}
            </div>
            <Panel groups={[...CONVERT, ...ORGANIZE]} onPick={() => setSheet(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}
