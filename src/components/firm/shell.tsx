"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { I, Logo } from "../icons";

export type FirmInfo = { name: string; slug: string; color: string; logo: string | null; portalUrl: string; host: string | null; subdomains: boolean; firmName: string; workspaceName: string; retentionYears: number | null };

const FirmCtx = createContext<{ firm: FirmInfo | null; reload: () => void }>({ firm: null, reload: () => {} });
export const useFirm = () => useContext(FirmCtx);

const NAV = [
  { href: "", label: "Dashboard", icon: <I.layers size={18} /> },
  { href: "/list", label: "Clients", icon: <I.users size={18} /> },
  { href: "/messages", label: "Messages", icon: <I.chat size={18} /> },
  { href: "/settings", label: "Firm settings", icon: <I.gear size={18} /> },
];

/** Light, Google-style frame for the firm screens: a sidebar on computers, a top bar and drawer on phones. */
export function FirmShell({ wid, children }: { wid: string; children: React.ReactNode }) {
  const path = usePathname();
  const base = `/app/${wid}/clients`;
  const [firm, setFirm] = useState<FirmInfo | null>(null);
  const [open, setOpen] = useState(false);
  const reload = useCallback(() => {
    api<FirmInfo>(`/api/workspaces/${wid}/firm`).then(setFirm).catch(() => {});
  }, [wid]);
  useEffect(reload, [reload]);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "" ? path === base : path.startsWith(base + href));
  const style = firm ? ({ "--firm": firm.color } as React.CSSProperties) : undefined;
  return (
    <FirmCtx.Provider value={{ firm, reload }}>
      <div className="mk firm-app" style={style}>
        <header className="fa-topbar">
          <button className="fa-menu-btn" onClick={() => setOpen(true)} aria-label="Menu">
            <I.menu size={20} />
          </button>
          <span className="fa-topbar-name ellipsis">{firm?.name ?? "Clients"}</span>
          <Link href={`/app/${wid}`} className="btn btn-sm btn-ghost">
            <I.left size={14} /> Workbench
          </Link>
        </header>
        {open && <div className="fa-scrim" onClick={() => setOpen(false)} />}
        <aside className={`fa-side ${open ? "open" : ""}`}>
          <div className="fa-brand">
            {firm?.logo ? <img src={firm.logo} alt="" className="fa-brand-logo" /> : <span className="fa-brand-mark">{(firm?.name ?? "F").slice(0, 1).toUpperCase()}</span>}
            <span className="fa-brand-text">
              <b className="ellipsis">{firm?.name ?? "Your firm"}</b>
              <span className="ellipsis">{firm?.host ?? "Client portal"}</span>
            </span>
          </div>
          <nav className="fa-nav">
            {NAV.map((n) => (
              <Link key={n.href} href={base + n.href} className={`fa-nav-item ${active(n.href) ? "on" : ""}`}>
                {n.icon}
                <span>{n.label}</span>
              </Link>
            ))}
          </nav>
          <div className="fa-side-foot">
            {firm && (
              <a className="fa-nav-item" href={firm.subdomains ? firm.portalUrl : `/portal/${firm.slug}`} target="_blank" rel="noreferrer" title="See the sign-in page your clients use">
                <I.link size={18} /> <span>Open client portal</span>
              </a>
            )}
            <Link className="fa-nav-item" href={`/app/${wid}`}>
              <Logo size={18} /> <span>Back to workbench</span>
            </Link>
          </div>
        </aside>
        <main className="fa-main">{children}</main>
      </div>
    </FirmCtx.Provider>
  );
}

export function PageHead({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="fa-head">
      <div className="fa-head-text">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="fa-head-actions">{children}</div>}
    </div>
  );
}
