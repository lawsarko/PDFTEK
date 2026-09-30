"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errMsg, initials, timeAgo } from "@/lib/client/api";
import { I, Logo } from "../icons";
import { Menu, Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";

type WsLite = { id: string; name: string; role: string; plan: string };
type Hit = { document_id: string; page: number; snippet: string; name: string };
type Notif = { id: string; workspaceId: string; title: string; body: string; link: string | null; readAt: number | null; createdAt: number };

export function TopBar() {
  const { wid, info } = useWB();
  const router = useRouter();
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<WsLite[]>([]);
  const [wsMenu, setWsMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [newWs, setNewWs] = useState(false);

  useEffect(() => {
    api<{ workspaces: WsLite[] }>("/api/me").then((r) => setWorkspaces(r.workspaces)).catch(() => {});
  }, [wid]);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="pdftek home">
        <Logo />
        <span className="hide-mobile">pdftek</span>
      </Link>

      {workspaces.length > 1 && workspaces.length <= 4 ? (
        <div className="ws-switch" role="tablist" aria-label="Workspaces">
          {workspaces.map((w) => (
            <button key={w.id} className={`ws-chip ${w.id === wid ? "active" : ""}`} onClick={() => router.push(`/app/${w.id}`)}>
              {w.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="menu-wrap">
        <button className="btn btn-sm btn-ghost" onClick={() => setWsMenu((v) => !v)} aria-haspopup="menu">
          <span className="ellipsis" style={{ maxWidth: 140 }}>
            {workspaces.length > 1 && workspaces.length <= 4 ? "" : info.workspace.name}
          </span>
          <I.chevron size={14} />
        </button>
        <Menu open={wsMenu} onClose={() => setWsMenu(false)} align="left">
          <div className="menu-label">Workspaces</div>
          {workspaces.map((w) => (
            <button key={w.id} className="menu-item" onClick={() => router.push(`/app/${w.id}`)}>
              <span className="grow ellipsis">{w.name}</span>
              {w.id === wid && <I.check size={14} />}
              <span className="badge badge-muted">{w.plan}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setWsMenu(false); setNewWs(true); }}>
            <I.plus size={14} /> New workspace
          </button>
          <Link className="menu-item" href={`/app/${wid}/settings`}>
            <I.gear size={14} /> Workspace settings
          </Link>
        </Menu>
      </div>

      <GlobalSearch />
      <div className="grow hide-mobile" />

      <Link href={`/app/${wid}/tools`} className="tool-btn hide-mobile" title="PDF tools">
        <I.tools size={14} /> Tools
      </Link>
      <Link href={`/app/${wid}/compare`} className="tool-btn hide-mobile" title="Compare documents">
        <I.compare size={14} /> Compare
      </Link>
      <div className="grow show-mobile" />
      <Notifications />
      <div className="menu-wrap">
        <button className="avatar" style={{ cursor: "pointer", width: 30, height: 30 }} onClick={() => setUserMenu((v) => !v)} aria-label="Account menu">
          {initials(info.me.name)}
        </button>
        <Menu open={userMenu} onClose={() => setUserMenu(false)}>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ fontWeight: 500 }}>{info.me.name}</div>
            <div className="small muted">{info.me.email}</div>
          </div>
          <div className="menu-sep" />
          <Link className="menu-item" href={`/app/${wid}/settings?tab=profile`}>
            <I.users size={14} /> Profile
          </Link>
          <Link className="menu-item" href={`/app/${wid}/settings?tab=members`}>
            <I.users size={14} /> Members
          </Link>
          <Link className="menu-item" href={`/app/${wid}/settings?tab=billing`}>
            <I.bolt size={14} /> Plan & billing <span className="badge badge-warn" style={{ marginLeft: "auto" }}>{info.workspace.plan}</span>
          </Link>
          <Link className="menu-item show-mobile" href={`/app/${wid}/tools`}>
            <I.tools size={14} /> PDF tools
          </Link>
          <Link className="menu-item show-mobile" href={`/app/${wid}/compare`}>
            <I.compare size={14} /> Compare
          </Link>
          <div className="menu-sep" />
          <button className="menu-item" onClick={logout}>
            <I.logout size={14} /> Sign out
          </button>
        </Menu>
      </div>

      {newWs && (
        <NewWorkspaceModal
          onClose={() => setNewWs(false)}
          onCreated={(id) => {
            toast("Workspace created", "success");
            router.push(`/app/${id}`);
          }}
        />
      )}
    </header>
  );
}

function NewWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ workspaceId: string }>("/api/workspaces", { method: "POST", json: { name } });
      onCreated(r.workspaceId);
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New workspace"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={submit}>Create</button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Legal, Research, Finance" onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} />
      </div>
      <p className="small muted mt-12">Workspaces keep documents, members, automations and billing separate — ideal for teams or clients.</p>
    </Modal>
  );
}

function GlobalSearch() {
  const { wid, openDoc, docs } = useWB();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ results: Hit[] }>(`/api/workspaces/${wid}/search?q=${encodeURIComponent(q)}`);
        setHits(r.results);
      } catch {
        setHits([]);
      }
    }, 220);
  }, [q, wid]);

  const nameHits = q.trim().length >= 2 ? docs.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5) : [];

  return (
    <div className="topbar-search">
      <I.search size={14} />
      <input
        className="input input-sm"
        placeholder="Search every page of every document…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setOpen(false))}
        aria-label="Search documents"
      />
      {open && q.trim().length >= 2 && (
        <div className="search-results">
          {nameHits.length > 0 && <div className="menu-label">Documents</div>}
          {nameHits.map((d) => (
            <button key={d.id} className="search-hit" onMouseDown={() => { setOpen(false); openDoc(d.id); }}>
              <div className="row">
                <I.file size={14} /> <span className="ellipsis">{d.name}</span>
              </div>
            </button>
          ))}
          <div className="menu-label">Inside documents</div>
          {hits === null && <div className="small muted" style={{ padding: 10 }}>Searching…</div>}
          {hits?.length === 0 && <div className="small muted" style={{ padding: 10 }}>No matches in document text.</div>}
          {hits?.map((h, i) => (
            <button key={i} className="search-hit" onMouseDown={() => { setOpen(false); openDoc(h.document_id, { page: h.page, text: q }); }}>
              <div className="row small">
                <span className="ellipsis" style={{ fontWeight: 500 }}>{h.name}</span>
                <span className="mono faint tiny">p.{h.page}</span>
              </div>
              <div className="small muted snippet" dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function snippetHtml(s: string) {
  const esc = s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return esc.replace(/\[\[/g, "<mark>").replace(/\]\]/g, "</mark>");
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Notif[]; unread: number }>("/api/notifications");
      setItems(r.items);
      setUnread(r.unread);
    } catch {}
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const markAll = async () => {
    await api("/api/notifications", { method: "POST", json: {} }).catch(() => {});
    setUnread(0);
    setItems((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? Date.now() })));
  };

  return (
    <div className="menu-wrap">
      <button className="icon-btn" style={{ position: "relative" }} onClick={() => { setOpen((v) => !v); void load(); }} aria-label="Notifications">
        <I.bell size={18} />
        {unread > 0 && (
          <span style={{ position: "absolute", top: 2, right: 2, background: "var(--amber)", color: "#1a1206", borderRadius: 999, fontSize: 9, fontWeight: 700, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        <div className="row between" style={{ padding: "6px 10px" }}>
          <span className="menu-label" style={{ padding: 0 }}>Notifications</span>
          {unread > 0 && <button className="btn btn-sm btn-ghost" onClick={markAll}>Mark all read</button>}
        </div>
        <div style={{ width: 320 }}>
          {items.length === 0 && <div className="empty small">You’re all caught up.</div>}
          {items.map((n) => (
            <button
              key={n.id}
              className="menu-item"
              style={{ alignItems: "flex-start", opacity: n.readAt ? 0.65 : 1 }}
              onClick={() => {
                setOpen(false);
                api("/api/notifications", { method: "POST", json: { ids: [n.id] } }).catch(() => {});
                if (n.link) router.push(n.link);
              }}
            >
              {!n.readAt && <span className="dot" style={{ marginTop: 7, background: "var(--amber)", boxShadow: "none" }} />}
              <span className="grow">
                <div style={{ fontSize: 13 }}>{n.title}</div>
                {n.body && <div className="sub ellipsis">{n.body}</div>}
                <div className="tiny faint mono">{timeAgo(n.createdAt)}</div>
              </span>
            </button>
          ))}
        </div>
      </Menu>
    </div>
  );
}
