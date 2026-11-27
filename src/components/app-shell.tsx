"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo, Wordmark, I } from "./icons";
import { UsageMeter } from "./paywall";

/** Header for full-page app screens (settings, tools, compare, signature setup). */
export function AppShell({ wid, title, children, actions }: { wid: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  // Same look as the workbench: light, or dark when the person chose dark mode there.
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      if (localStorage.getItem("pdftek-theme") === "dark") setTheme("dark");
    } catch {}
  }, []);
  return (
    <div className="mk wb2 app-shell" data-theme={theme} style={{ minHeight: "100vh" }}>
      <header className="topbar app-shell-top">
        <Link href="/" className="brand">
          <Logo />
          <span className="hide-mobile"><Wordmark /></span>
        </Link>
        <Link href={`/app/${wid}`} className="btn btn-ghost btn-sm" aria-label="Back to the workbench">
          <I.left size={14} /> <span className="shell-back-label">Workbench</span>
        </Link>
        <span className="viewer-title ellipsis">{title}</span>
        <span className="grow" />
        <UsageMeter wid={wid} />
        {actions && <span className="topbar-actions row gap-6">{actions}</span>}
        <Link href={`/app/${wid}/tools`} className="tool-btn hide-mobile">
          <I.tools size={13} /> Tools
        </Link>
        <Link href={`/app/${wid}/compare`} className="tool-btn hide-mobile">
          <I.compare size={13} /> Compare
        </Link>
        <a href="/help" target="_blank" rel="noreferrer" className="icon-btn" aria-label="Help" title="Help: guides and videos">
          <I.help size={17} />
        </a>
        <Link href={`/app/${wid}/settings`} className="icon-btn" aria-label="Settings">
          <I.gear size={16} />
        </Link>
      </header>
      {children}
    </div>
  );
}
