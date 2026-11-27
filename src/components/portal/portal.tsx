"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import { STAGES } from "@/lib/client-shared";
import { I } from "../icons";
import { useToast } from "../toast";
import { ScanButton } from "../scan";

type Brand = { name: string; slug: string | null; color: string; logo: string | null };
type Item = {
  id: string;
  label: string;
  note: string;
  required: boolean;
  accept: "any" | "pdf" | "image" | "office";
  acceptLabel: string;
  status: "needed" | "uploaded" | "returned" | "na";
  files: string[];
  feedback: string | null;
  uploadedAt: number | null;
  aiStatus: "checking" | "ok" | "flagged" | "skipped" | null;
  ai: { summary: string; problems: string[] } | null;
  naReason: string | null;
};
type Req = { id: string; title: string; message: string; dueDate: string | null; year: number | null; status: string; items: Item[] };
type FileRow = { id: string; name: string; pages: number; year: number | null; category: string; source: "client" | "firm"; pay: { cents: number; currency: string; description: string; paidAt: number | null } | null; createdAt: number };
type Home = {
  firm: Brand;
  client: { name: string; email: string };
  requests: Req[];
  files: FileRow[];
  messages: { id: string; author: "firm" | "client"; authorName: string; body: string; createdAt: number }[];
  toSign: { title: string; url: string; createdAt: number }[];
  progress: { year: number; service: string; stage: string; label: string }[];
};

const ACCEPT: Record<Item["accept"], string | undefined> = {
  any: undefined,
  pdf: ".pdf,application/pdf",
  image: "image/*,.pdf,.heic,.tif,.tiff",
  office: ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods",
};
const money = (cents: number, cur = "usd") => new Intl.NumberFormat(undefined, { style: "currency", currency: cur.toUpperCase() }).format(cents / 100);
const isOpen = (s: string) => ["pending", "viewed", "in_progress"].includes(s);

/** The client side of Clients: what a firm's client sees at firm.pdftek.com. */
export function Portal({ slug, brand, signedIn, expired }: { slug: string; brand: Brand; signedIn: boolean; expired: boolean }) {
  const [authed, setAuthed] = useState(signedIn);
  const style = { "--firm": brand.color } as React.CSSProperties;
  return (
    <div className="mk portal" style={style}>
      <header className="pt-bar">
        <div className="pt-bar-inner">
          {brand.logo ? <img src={brand.logo} alt={brand.name} className="pt-logo" /> : <span className="pt-mark">{brand.name.slice(0, 1).toUpperCase()}</span>}
          <b className="pt-name ellipsis">{brand.name}</b>
          <span className="grow" />
          {authed && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await api(`/api/portal/${slug}/logout`, { method: "POST" }).catch(() => {});
                setAuthed(false);
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      {authed ? <PortalHome slug={slug} onSignedOut={() => setAuthed(false)} /> : <SignIn slug={slug} brand={brand} expired={expired} onDone={() => setAuthed(true)} />}
      <footer className="pt-foot">
        <I.lock size={13} /> Secure portal for {brand.name} · encrypted connection · powered by <a href="https://pdftek.com" target="_blank" rel="noreferrer">pdftek</a>
      </footer>
    </div>
  );
}

function SignIn({ slug, brand, expired, onDone }: { slug: string; brand: Brand; expired: boolean; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await api(`/api/portal/${slug}/login`, { method: "POST", json: { email } });
      setStep("code");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function verify(c = code) {
    setBusy(true);
    try {
      await api(`/api/portal/${slug}/verify`, { method: "POST", json: { email, code: c } });
      onDone();
    } catch (e) {
      toast(errMsg(e), "error");
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pt-auth">
      <div className="pt-auth-card">
        <span className="pt-auth-ico"><I.lock size={22} /></span>
        {step === "email" ? (
          <>
            <h1>Welcome to {brand.name}</h1>
            <p className="muted">Sign in to upload documents, see what’s needed and message the team. We’ll email you a code; there’s no password.</p>
            {expired && <div className="notice" style={{ marginBottom: 12 }}>That sign-in link has expired or was already used. Enter your email for a new one.</div>}
            <form
              className="col gap-12"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) void send();
              }}
            >
              <div className="field">
                <label htmlFor="pt-email">Email address</label>
                <input id="pt-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
            </form>
          </>
        ) : (
          <>
            <h1>Check your email</h1>
            <p className="muted">
              If <b>{email}</b> is registered with {brand.name}, we’ve sent a 6-digit code and a sign-in button. It expires in 15 minutes.
            </p>
            <form
              className="col gap-12"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length >= 6) void verify();
              }}
            >
              <div className="field">
                <label htmlFor="pt-code">6-digit code</label>
                <input
                  id="pt-code"
                  className="input pt-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCode(v);
                    if (v.length === 6) void verify(v);
                  }}
                  autoFocus
                />
              </div>
              <button className="btn btn-primary btn-lg" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep("email")}>Use a different email</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

type Tab = "todo" | "documents" | "messages" | "sign";

function PortalHome({ slug, onSignedOut }: { slug: string; onSignedOut: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Home | null>(null);
  const [tab, setTab] = useState<Tab>("todo");
  const load = useCallback(() => {
    api<Home>(`/api/portal/${slug}/me`)
      .then(setD)
      .catch((e) => {
        if (String(errMsg(e)).includes("sign in")) onSignedOut();
        else toast(errMsg(e), "error");
      });
  }, [slug, toast, onSignedOut]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab") as Tab | null;
    if (t) setTab(t);
    const paid = q.get("paid");
    const session = q.get("session");
    if (paid && session) {
      setTab("documents");
      void api<{ paid: boolean }>(`/api/portal/${slug}/pay`, { method: "POST", json: { fileId: paid, session } })
        .then((r) => toast(r.paid ? "Payment received. Thank you! Your document is unlocked." : "We couldn't confirm the payment yet. Refresh in a moment.", r.paid ? "success" : "info"))
        .finally(load);
      window.history.replaceState(null, "", window.location.pathname);
    } else load();
  }, [slug, load, toast]);
  // Uploads are checked in the background: refresh while a check is running.
  useEffect(() => {
    if (!d?.requests.some((r) => r.items.some((i) => i.aiStatus === "checking"))) return;
    const t = setTimeout(load, 3500);
    return () => clearTimeout(t);
  }, [d, load]);

  if (!d) return <div className="fa-loading"><span className="spinner spinner-lg" /></div>;
  const open = d.requests.filter((r) => isOpen(r.status));
  const done = d.requests.filter((r) => r.status === "complete");
  const left = open.flatMap((r) => r.items).filter((i) => i.status === "needed" || i.status === "returned").length;
  const current = d.progress[0];
  const idx = current ? STAGES.findIndex((s) => s.key === current.stage) : -1;
  const first = d.client.name.split(" ")[0];

  return (
    <main className="pt-main">
      <section className="pt-hello">
        <h1>Hi {first}</h1>
        <p>{left ? `${left} document${left === 1 ? "" : "s"} still needed from you.` : open.length ? "You've sent everything we asked for. Thank you!" : "Nothing is needed from you right now."}</p>
        {current && (
          <div className="pt-track">
            <div className="small muted">
              Your {current.year} {current.service.toLowerCase()}: <b style={{ color: "var(--text-hi)" }}>{current.label}</b>
            </div>
            <ol className="pt-track-steps" aria-label="Progress">
              {STAGES.map((s, i) => (
                <li key={s.key} className={i < idx ? "done" : i === idx ? "on" : ""} title={s.label} />
              ))}
            </ol>
          </div>
        )}
      </section>

      <nav className="pt-tabs" role="tablist">
        {(
          [
            ["todo", "To do", left],
            ["documents", "Documents", 0],
            ["messages", "Messages", 0],
            ...(d.toSign.length ? [["sign", "Sign", d.toSign.length] as [Tab, string, number]] : []),
          ] as [Tab, string, number][]
        ).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
            {n > 0 && <span className="fa-count hot">{n}</span>}
          </button>
        ))}
      </nav>

      {tab === "todo" && (
        <div className="col gap-16">
          {!open.length && (
            <div className="pt-card pt-empty">
              <span className="fa-empty-ico"><I.check size={24} /></span>
              <h3>You’re all caught up</h3>
              <p className="muted small">When {d.firm.name} needs something, it’ll show up here and we’ll email you.</p>
            </div>
          )}
          {open.map((r) => (
            <RequestCard key={r.id} slug={slug} r={r} firm={d.firm.name} onChange={load} />
          ))}
          {done.length > 0 && (
            <details className="pt-card pt-done">
              <summary>
                {done.length} completed request{done.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {done.map((r) => (
                  <li key={r.id}>
                    <I.check size={14} /> {r.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === "documents" && <Documents slug={slug} d={d} onChange={load} />}
      {tab === "messages" && <Messages slug={slug} d={d} onChange={load} />}
      {tab === "sign" && (
        <div className="pt-card">
          <ul className="pt-list">
            {d.toSign.map((s) => (
              <li key={s.url}>
                <span className="pt-file-ico firm"><I.sign size={16} /></span>
                <span className="grow">
                  <b>{s.title}</b>
                  <span className="small muted" style={{ display: "block" }}>Sent {timeAgo(s.createdAt)}</span>
                </span>
                <a className="btn btn-primary btn-sm" href={s.url}>Review & sign</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function RequestCard({ slug, r, firm, onChange }: { slug: string; r: Req; firm: string; onChange: () => void }) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const ready = r.items.every((i) => !i.required || i.status === "uploaded" || i.status === "na");
  const doneCount = r.items.filter((i) => i.status === "uploaded" || i.status === "na").length;
  async function submit() {
    setSending(true);
    try {
      await api(`/api/portal/${slug}/submit`, { method: "POST", json: { requestId: r.id } });
      toast(`Sent to ${firm}. Thank you!`, "success");
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="pt-card">
      <div className="pt-req-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <h2>{r.title}</h2>
          <div className="small muted">
            {doneCount} of {r.items.length} done{r.dueDate ? ` · please finish by ${new Date(`${r.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}` : ""}
          </div>
        </div>
      </div>
      {r.message && <p className="pt-msg">{r.message}</p>}
      <span className="fa-progress-bar" style={{ margin: "10px 0 4px" }}>
        <i style={{ width: `${(doneCount / Math.max(1, r.items.length)) * 100}%` }} />
      </span>
      <ul className="pt-items">
        {r.items.map((i) => (
          <ItemRow key={i.id} slug={slug} requestId={r.id} item={i} onChange={onChange} />
        ))}
      </ul>
      <div className="pt-req-foot">
        <button className="btn btn-primary" disabled={!ready || sending} onClick={submit}>
          {sending ? "Sending…" : ready ? `I'm done, send to ${firm}` : "Finish the required items to send"}
        </button>
      </div>
    </div>
  );
}

function ItemRow({ slug, requestId, item, onChange }: { slug: string; requestId: string; item: Item; onChange: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [na, setNa] = useState(false);
  const [why, setWhy] = useState("");
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const f = new FormData();
      f.append("requestId", requestId);
      f.append("itemId", item.id);
      for (const x of files) f.append("files", x);
      await api(`/api/portal/${slug}/upload`, { method: "POST", body: f });
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function setNotApplicable(reason: string | null) {
    try {
      await api(`/api/portal/${slug}/item`, { method: "POST", json: { requestId, itemId: item.id, notApplicable: reason } });
      setNa(false);
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }
  const done = item.status === "uploaded";
  return (
    <li
      className={`pt-item ${item.status}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload([...e.dataTransfer.files]);
      }}
    >
      <span className={`fa-check-ico ${item.status}`}>{done ? <I.check size={13} /> : item.status === "na" ? <I.x size={12} /> : item.status === "returned" ? <I.undo size={13} /> : null}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className={`pt-item-label ${item.status === "na" ? "faint" : ""}`}>
          {item.label}
          {!item.required && <span className="small faint"> · if you have it</span>}
        </div>
        {item.note && item.status !== "uploaded" && <div className="small muted">{item.note}</div>}
        {done && <div className="small muted ellipsis">{item.files.join(", ")}</div>}
        {item.status === "na" && <div className="small muted">Doesn’t apply: {item.naReason}</div>}
        {item.status === "returned" && item.feedback && (
          <div className="fa-ai flagged">
            <I.info size={13} /> Please upload a new copy: {item.feedback}
          </div>
        )}
        {done && item.aiStatus === "checking" && (
          <div className="fa-ai checking">
            <span className="spinner" /> Checking your document…
          </div>
        )}
        {done && item.aiStatus === "flagged" && item.ai && (
          <div className="fa-ai flagged">
            <I.info size={13} /> {item.ai.problems.join(" ")} If it’s right, you don’t need to do anything.
          </div>
        )}
        {done && item.aiStatus === "ok" && item.ai && (
          <div className="fa-ai ok">
            <I.check size={13} /> {item.ai.summary}
          </div>
        )}
        {na && (
          <form
            className="pt-na"
            onSubmit={(e) => {
              e.preventDefault();
              void setNotApplicable(why || "Doesn't apply this year");
            }}
          >
            <input className="input input-sm" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why? e.g. no mortgage this year (optional)" autoFocus />
            <button className="btn btn-sm btn-primary">Confirm</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNa(false)}>Cancel</button>
          </form>
        )}
      </div>
      <div className="pt-item-actions">
        {busy ? (
          <span className="small muted row gap-4"><span className="spinner" /> Uploading…</span>
        ) : item.status === "na" ? (
          <button className="btn btn-sm btn-ghost" onClick={() => setNotApplicable(null)}>Undo</button>
        ) : (
          <>
            <button className={`btn btn-sm ${done ? "btn-ghost" : "btn-primary"}`} onClick={() => input.current?.click()}>
              <I.upload size={14} /> {done ? "Replace" : "Upload"}
            </button>
            {!done && <ScanButton className="btn btn-sm" label="Scan" onScanned={(f) => upload([f])} baseName={item.label} />}
            {!done && !na && (
              <button className="btn btn-sm btn-ghost" onClick={() => setNa(true)}>
                Doesn’t apply
              </button>
            )}
          </>
        )}
        <input ref={input} type="file" multiple hidden accept={ACCEPT[item.accept]} onChange={(e) => upload([...(e.target.files ?? [])])} />
      </div>
    </li>
  );
}

function Documents({ slug, d, onChange }: { slug: string; d: Home; onChange: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const years = [...new Set(d.files.map((f) => f.year ?? 0))].sort((a, b) => b - a);
  async function pay(fileId: string) {
    try {
      const r = await api<{ url: string }>(`/api/portal/${slug}/pay`, { method: "POST", json: { fileId } });
      window.location.href = r.url;
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }
  async function uploadOther(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const f = new FormData();
      f.append("label", label || "Other document");
      for (const x of files) f.append("files", x);
      await api(`/api/portal/${slug}/upload`, { method: "POST", body: f });
      toast(`Sent to ${d.firm.name}.`, "success");
      setLabel("");
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="col gap-16">
      <div className="pt-card pt-other">
        <div className="grow" style={{ minWidth: 200 }}>
          <b>Send something else</b>
          <div className="small muted">A letter you received, a receipt, anything {d.firm.name} should see.</div>
        </div>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What is it? (optional)" style={{ maxWidth: 260 }} />
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          <I.upload size={15} /> {busy ? "Uploading…" : "Upload"}
        </button>
        <ScanButton className="btn" label="Scan" onScanned={(f) => uploadOther([f])} />
        <input ref={input} type="file" multiple hidden onChange={(e) => uploadOther([...(e.target.files ?? [])])} />
      </div>
      {!d.files.length && (
        <div className="pt-card pt-empty">
          <span className="fa-empty-ico"><I.folder size={24} /></span>
          <h3>No documents yet</h3>
          <p className="muted small">Documents you upload, and the ones {d.firm.name} shares with you, are kept here by year.</p>
        </div>
      )}
      {years.map((y) => (
        <div key={y} className="pt-card">
          <h2 className="pt-year">{y ? y : "Other"}</h2>
          <ul className="pt-list">
            {d.files
              .filter((f) => (f.year ?? 0) === y)
              .map((f) => {
                const locked = f.pay && !f.pay.paidAt;
                return (
                  <li key={f.id}>
                    <span className={`pt-file-ico ${f.source}`}><I.file size={16} /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <b className="ellipsis" style={{ display: "block" }}>{f.name}</b>
                      <span className="small muted">
                        {f.source === "firm" ? `From ${d.firm.name}` : "You uploaded"} · {timeAgo(f.createdAt)}
                      </span>
                    </span>
                    {locked ? (
                      <button className="btn btn-sm btn-primary" onClick={() => pay(f.id)}>
                        <I.lock size={13} /> Pay {money(f.pay!.cents, f.pay!.currency)} to unlock
                      </button>
                    ) : (
                      <span className="row gap-4">
                        <a className="btn btn-sm btn-ghost" href={`/api/portal/${slug}/files/${f.id}`} target="_blank" rel="noreferrer">View</a>
                        <a className="btn btn-sm" href={`/api/portal/${slug}/files/${f.id}?download=1`}>
                          <I.download size={14} />
                        </a>
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Messages({ slug, d, onChange }: { slug: string; d: Home; onChange: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [d.messages.length]);
  async function send() {
    setBusy(true);
    try {
      await api(`/api/portal/${slug}/messages`, { method: "POST", json: { body: text } });
      setText("");
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fa-card fa-thread">
      <div className="fa-msgs">
        {!d.messages.length && <p className="muted small" style={{ textAlign: "center", margin: "24px 0" }}>Questions for {d.firm.name}? Send a secure message here.</p>}
        {d.messages.map((m) => (
          <div key={m.id} className={`fa-msg ${m.author === "client" ? "firm" : "client"}`}>
            <div className="fa-msg-meta">
              <b>{m.author === "client" ? "You" : m.authorName}</b> · {timeAgo(m.createdAt)}
            </div>
            <div className="fa-msg-body">{m.body}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="fa-compose">
        <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${d.firm.name}`} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={send}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
