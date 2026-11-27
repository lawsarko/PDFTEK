"use client";
import { useId, useMemo, useState } from "react";
import { I } from "../icons";
import { ToolIcon } from "../tool-icon";
import { RIBBON, type Act } from "./ribbon";

/**
 * Illustrated icon for each workbench tool (the same art as the tools pages). Tools without their
 * own illustration use a plain icon on a soft tile.
 */
export const TOOL_ART: Record<string, string> = {
  "convert-docx": "pdf-to-word",
  "convert-xlsx": "pdf-to-excel",
  "convert-pptx": "pdf-to-powerpoint",
  "convert-jpg": "pdf-to-jpg",
  "convert-png": "pdf-to-jpg",
  "convert-more": "bulk-pdf-converter",
  statement: "bank-statement-to-excel",
  invoice: "invoice-to-excel",
  topdf: "word-to-pdf",
  images: "jpg-to-pdf",
  scan: "scan-to-pdf",
  ocr: "ocr-pdf",
  edit: "edit-pdf",
  watermark: "watermark-pdf",
  page_numbers: "add-page-numbers-to-pdf",
  organize: "organize-pdf",
  merge: "merge-pdf",
  split: "split-pdf",
  rotate: "rotate-pdf",
  optimize: "compress-pdf",
  compare: "compare-pdf",
  fill: "fill-pdf-form",
  sign: "sign-pdf",
  "sign-hub": "esignature-templates",
  request: "request-documents",
  protect: "protect-pdf",
  unlock: "unlock-pdf",
  translate: "translate-pdf",
  ask: "chat-with-pdf",
  read: "read-pdf-aloud",
};

export function ToolArt({ act, size = 30 }: { act: Act; size?: number }) {
  const uid = useId();
  const slug = TOOL_ART[act.key];
  if (slug) return <ToolIcon slug={slug} size={size} className="wb-art" uid={uid} />;
  return (
    <span className="wb-art wb-art-plain" style={{ width: size, height: size }}>
      {act.icon}
    </span>
  );
}

const GROUP_LABEL: Record<string, string> = { ai: "AI" };

/**
 * Every tool in one scrollable list, grouped, with a filter box. Each entry runs the same action
 * the toolbar used to run.
 */
export function ToolsPanel({
  run,
  member,
  hasDoc,
  ready,
  labels = {},
  menu,
  current,
  onClose,
}: {
  run: (key: string) => void;
  member: boolean;
  hasDoc: boolean;
  ready: boolean;
  labels?: Record<string, string>;
  menu?: { key: string; node: React.ReactNode } | null;
  /** The tool in use (highlighted). */
  current?: string | null;
  onClose?: () => void;
}) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    // A tool listed in two tabs (Redact, Fill form) appears once, in its first group.
    const seen = new Set<string>();
    return RIBBON.map((g) => ({
      ...g,
      acts: g.acts.filter((a) => {
        if (seen.has(a.key)) return false;
        seen.add(a.key);
        return !s || `${a.label} ${a.hint} ${g.label}`.toLowerCase().includes(s);
      }),
    })).filter((g) => g.acts.length);
  }, [q]);

  return (
    <aside className="wb-tools" aria-label="All tools">
      <div className="wb-tools-head">
        <label className="wb-tsearch">
          <I.search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tool" aria-label="Find a tool" onKeyDown={(e) => {
            if (e.key === "Enter" && groups[0]?.acts[0]) run(groups[0].acts[0].key);
            if (e.key === "Escape") setQ("");
          }} />
        </label>
        {onClose && (
          <button className="wb-ibtn" onClick={onClose} aria-label="Close tools">
            <I.x size={18} />
          </button>
        )}
      </div>
      <div className="wb-tools-list">
        {groups.map((g) => (
          <div key={g.key} className="wb-tg">
            <div className="wb-tgh">{GROUP_LABEL[g.key] ?? g.label}</div>
            {g.acts.map((a) => {
              const disabled = hasDoc && !ready && a.key.startsWith("convert-");
              return (
                <div key={a.key} className="menu-wrap">
                  <button className={`wb-ti ${current === a.key ? "on" : ""}`} title={a.hint} disabled={disabled} onClick={() => run(a.key)}>
                    <ToolArt act={a} />
                    <span className="grow ellipsis">{labels[a.key] ?? a.label}</span>
                    {a.pro && !member && <span className="pro-tag">PRO</span>}
                    {a.ai && <em className="wb-ai-tag" title="Uses AI credits">AI</em>}
                  </button>
                  {menu?.key === a.key && menu.node}
                </div>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && <div className="empty small">No tool matches “{q}”.</div>}
      </div>
    </aside>
  );
}
