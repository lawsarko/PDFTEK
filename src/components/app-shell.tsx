"use client";
import Link from "next/link";
import { Logo, I } from "./icons";

/** Header for full-page app screens (settings, tools, compare, signature setup). */
export function AppShell({ wid, title, children, actions }: { wid: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <Link href="/" className="brand">
          <Logo />
          <span className="hide-mobile">pdftek</span>
        </Link>
        <Link href={`/app/${wid}`} className="btn btn-ghost btn-sm">
          <I.left size={14} /> Workbench
        </Link>
        <span className="viewer-title ellipsis">{title}</span>
        <span className="grow" />
        {actions}
        <Link href={`/app/${wid}/tools`} className="tool-btn hide-mobile">
          <I.tools size={13} /> Tools
        </Link>
        <Link href={`/app/${wid}/compare`} className="tool-btn hide-mobile">
          <I.compare size={13} /> Compare
        </Link>
        <Link href={`/app/${wid}/settings`} className="icon-btn" aria-label="Settings">
          <I.gear size={16} />
        </Link>
      </header>
      {children}
    </div>
  );
}
