"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errMsg, initials, timeAgo } from "@/lib/client/api";
import { I, Logo, Wordmark } from "../icons";
import { openPlans, planLabel, useUsage } from "../paywall";
import { RIBBON, type Act } from "./ribbon";
import { LanguageDialog, useLanguageName } from "../i18n";
import { Menu, Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";
import { FeedbackDialog } from "./feedback";

type WsLite = { id: string; name: string; role: string; plan: string };
type Hit = { document_id: string; page: number; snippet: string; name: string };
type Notif = { id: string; workspaceId: string; title: string; body: string; link: string | null; readAt: number | null; createdAt: number };

export function TopBar() {
  return (
    <header className="topbar wb-top">
      <Link href="/" className="brand" aria-label="pdftek home">
        <Logo />
        <span className="hide-mobile"><Wordmark /></span>
      </Link>
      <div className="wb-top-search hide-mobile">
        <GlobalSearch />
      </div>
      <div className="grow" />
      <WorkspaceSwitch />
      <AccountButtons />
    </header>
  );
}

/** The current workspace as a pill; the menu switches workspaces or makes a new one. */
export function WorkspaceSwitch() {
  const { wid, info } = useWB();
  const router = useRouter();
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<WsLite[]>([]);
  const [wsMenu, setWsMenu] = useState(false);
  const [newWs, setNewWs] = useState(false);

  useEffect(() => {
    api<{ workspaces: WsLite[] }>("/api/me").then((r) => setWorkspaces(r.workspaces)).catch(() => {});
  }, [wid]);

  return (
    <div className="menu-wrap ws-wrap">
      <button className="wb-ws ws-btn" onClick={() => setWsMenu((v) => !v)} aria-haspopup="menu" title="Switch workspace">
        <span className="ellipsis ws-name">{info.workspace.name}</span>
        <I.chevron size={16} />
      </button>
      <Menu open={wsMenu} onClose={() => setWsMenu(false)}>
        <div className="menu-label">Workspaces</div>
        {workspaces.map((w) => (
          <button key={w.id} className="menu-item" onClick={() => { setWsMenu(false); router.push(`/app/${w.id}`); }}>
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
      {newWs && (
        <NewWorkspaceModal
          onClose={() => setNewWs(false)}
          onCreated={(id) => {
            toast("Workspace created", "success");
            router.push(`/app/${id}`);
          }}
        />
      )}
    </div>
  );
}

/** Bell and account menu (plan and credits, settings, theme, language, feedback, sign out). */
export function AccountButtons() {
  const { wid, info, theme, setTheme, active, openDoc } = useWB();
  const [userMenu, setUserMenu] = useState(false);
  const [helpMenu, setHelpMenu] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const languageName = useLanguageName();
  const [feedback, setFeedback] = useState(false);
  const usage = useUsage(wid);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      <div className="menu-wrap">
        <button className="wb-ibtn wb-help" onClick={() => setHelpMenu((v) => !v)} aria-label="Help" title="Help: guides and videos">
          <I.help size={20} />
        </button>
        <Menu open={helpMenu} onClose={() => setHelpMenu(false)}>
          <a className="menu-item" href="/help" target="_blank" rel="noreferrer">
            <I.help size={14} /> Help Center: guides and videos
          </a>
          {active && (
            <a className="menu-item" href="/help/getting-started" target="_blank" rel="noreferrer">
              <I.play size={14} /> Watch: get started
            </a>
          )}
          <button
            className="menu-item"
            onClick={() => {
              setHelpMenu(false);
              if (active) openDoc(null);
              setTimeout(() => window.dispatchEvent(new Event("pdftek:tour")), active ? 600 : 0);
            }}
          >
            <I.steps size={14} /> Take the tour
          </button>
          <Link className="menu-item" href="/contact">
            <I.mail size={14} /> Contact support
          </Link>
        </Menu>
      </div>
      <Notifications />
      <div className="menu-wrap">
        <button className="avatar wb-avatar" onClick={() => setUserMenu((v) => !v)} aria-label="Account menu">
          {initials(info.me.name)}
        </button>
        <Menu open={userMenu} onClose={() => setUserMenu(false)}>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ fontWeight: 500 }}>{info.me.name}</div>
            <div className="small muted">{info.me.email}</div>
          </div>
          {usage && (
            <button className="menu-item wb-usage-item" onClick={() => { setUserMenu(false); openPlans(usage); }}>
              <I.sparkle size={14} />
              <span className="grow">
                {planLabel(usage)}
                <span className="sub">{(usage.credits + usage.allowance).toLocaleString()} AI credits</span>
              </span>
              <span className="badge badge-warn">{usage.membership ? "Top up" : "Upgrade"}</span>
            </button>
          )}
          <div className="menu-sep" />
          <Link className="menu-item" href={`/app/${wid}/settings?tab=profile`}>
            <I.user size={14} /> Profile
          </Link>
          <Link className="menu-item" href={`/app/${wid}/settings?tab=members`}>
            <I.users size={14} /> Members
          </Link>
          <Link className="menu-item" href={`/app/${wid}/settings?tab=billing`}>
            <I.bolt size={14} /> Plan & billing <span className="badge badge-warn" style={{ marginLeft: "auto" }}>{info.workspace.plan}</span>
          </Link>
          <Link className="menu-item" href={`/app/${wid}/clients`}>
            <I.users size={14} /> Clients
          </Link>
          <Link className="menu-item" href={`/app/${wid}/tools`}>
            <I.tools size={14} /> PDF tools
          </Link>
          <Link className="menu-item" href={`/app/${wid}/compare`}>
            <I.compare size={14} /> Compare
          </Link>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setUserMenu(false); setTheme(theme === "dark" ? "light" : "dark"); }}>
            {theme === "dark" ? <I.sun size={14} /> : <I.moon size={14} />} {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            className="menu-item"
            data-no-translate
            onClick={() => {
              setUserMenu(false);
              setLangOpen(true);
            }}
          >
            <I.globe size={14} /> {languageName}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setUserMenu(false);
              setFeedback(true);
            }}
          >
            <I.chat size={14} /> Send feedback
          </button>
          <Link className="menu-item" href="/contact">
            <I.mail size={14} /> Contact support
          </Link>
          <div className="menu-sep" />
          <button className="menu-item" onClick={logout}>
            <I.logout size={14} /> Sign out
          </button>
        </Menu>
      </div>
      {langOpen && <LanguageDialog onClose={() => setLangOpen(false)} />}
      {feedback && <FeedbackDialog wid={wid} onClose={() => setFeedback(false)} />}
    </>
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

const TOOLS: Act[] = RIBBON.flatMap((g) => g.acts).filter((a, i, l) => l.findIndex((b) => b.key === a.key) === i);

/**
 * One search for everything: tools, document names, text inside every page, or a question for
 * the AI. "/" jumps here from anywhere.
 */
export function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void } = {}) {
  const { wid, openDoc, docs, active, openAI, info } = useWB();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const input = useRef<HTMLInputElement>(null);

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

  // "/" focuses the search, like most professional apps (only the visible box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      if (!input.current || !input.current.offsetParent) return;
      e.preventDefault();
      input.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const s = q.trim().toLowerCase();
  const nameHits = s.length >= 2 ? docs.filter((d) => d.name.toLowerCase().includes(s)).slice(0, 5) : [];
  const toolHits = s.length >= 2 ? TOOLS.filter((a) => `${a.label} ${a.hint}`.toLowerCase().includes(s)).slice(0, 4) : [];
  const close = () => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    onDone?.();
  };
  const runTool = (key: string) => {
    close();
    window.dispatchEvent(new CustomEvent("pdftek:run", { detail: { key } }));
  };
  const ask = () => {
    const question = q.trim();
    close();
    openAI("chat");
    setTimeout(() => window.dispatchEvent(new CustomEvent("pdftek:ask", { detail: { question, submit: true } })), 300);
  };

  return (
    <div className="topbar-search wb-search">
      <I.search size={18} />
      <input
        ref={input}
        autoFocus={autoFocus}
        className="input"
        placeholder="Search documents, tools, or ask…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            onDone?.();
          }, 180)
        }
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (!q) onDone?.();
            close();
          }
          else if (e.key === "Enter" && s.length >= 2) {
            if (toolHits[0] && !nameHits.length) runTool(toolHits[0].key);
            else if (nameHits[0]) {
              close();
              openDoc(nameHits[0].id);
            } else if (info.capabilities.ai) ask();
          }
        }}
        aria-label="Search documents, tools, or ask"
      />
      <kbd className="hide-mobile">/</kbd>
      {open && s.length >= 2 && (
        <div className="search-results">
          {toolHits.length > 0 && <div className="menu-label">Tools</div>}
          {toolHits.map((a) => (
            <button key={a.key} className="search-hit" onMouseDown={(e) => e.preventDefault()} onClick={() => runTool(a.key)}>
              <div className="row">
                {a.icon} <span className="ellipsis">{a.label}</span>
                <span className="tiny faint ellipsis">{a.hint}</span>
              </div>
            </button>
          ))}
          {nameHits.length > 0 && <div className="menu-label">Documents</div>}
          {nameHits.map((d) => (
            <button key={d.id} className="search-hit" onMouseDown={() => { close(); openDoc(d.id); }}>
              <div className="row">
                <I.file size={14} /> <span className="ellipsis">{d.name}</span>
              </div>
            </button>
          ))}
          <div className="menu-label">Inside documents</div>
          {hits === null && <div className="small muted" style={{ padding: 10 }}>Searching…</div>}
          {hits?.length === 0 && <div className="small muted" style={{ padding: 10 }}>No matches in document text.</div>}
          {hits?.map((h, i) => (
            <button key={i} className="search-hit" onMouseDown={() => { setOpen(false); onDone?.(); openDoc(h.document_id, { page: h.page, text: q }); }}>
              <div className="row small">
                <span className="ellipsis" style={{ fontWeight: 500 }}>{h.name}</span>
                <span className="mono faint tiny">p.{h.page}</span>
              </div>
              <div className="small muted snippet" dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />
            </button>
          ))}
          {info.capabilities.ai && (
            <>
              <div className="menu-sep" />
              <button className="search-hit wb-ask-hit" onMouseDown={(e) => e.preventDefault()} onClick={ask}>
                <div className="row">
                  <I.sparkle size={14} /> <span className="ellipsis">Ask AI {active ? "about this document" : "across your library"}: “{q.trim()}”</span>
                </div>
              </button>
            </>
          )}
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
      <button className="wb-ibtn" onClick={() => { setOpen((v) => !v); void load(); }} aria-label="Notifications">
        <I.bell size={20} />
        {unread > 0 && (
          <span className="wb-dot">
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
