"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import { CLIENT_KINDS, STAGES, seasonYear, type Stage } from "@/lib/client-shared";
import { I } from "../icons";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { Avatar, Empty, fmtDate } from "./ui";
import { ClientFormModal, type ClientFields } from "./client-form";
import { RequestBuilder } from "./request-builder";
import { portalStatus } from "./directory";

type Ai = { formType: string; taxYear: number | null; issuer: string; summary: string; problems: string[]; suggestedName?: string; amounts?: { label: string; amount: number }[] };
type Item = { id: string; label: string; status: "needed" | "uploaded" | "returned" | "na"; aiStatus: string | null; ai: Ai | null; naReason: string | null; feedback: string | null; documentId: string | null; uploadedAt: number | null; required: boolean };
type Req = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  year: number | null;
  createdAt: number;
  viewedAt: number | null;
  completedAt: number | null;
  lastRemindedAt: number | null;
  received: number;
  notApplicable: number;
  total: number;
  link: string;
  verify: string;
  items: Item[];
};
type File = {
  id: string;
  documentId: string;
  name: string;
  pages: number;
  year: number | null;
  category: string;
  source: "client" | "firm";
  shared: boolean;
  ai: Ai | null;
  pay: { cents: number; currency: string; description: string; paidAt: number | null } | null;
  clientViewedAt: number | null;
  createdAt: number;
};
type Msg = { id: string; author: "firm" | "client"; authorName: string; body: string; internal: boolean; readAt: number | null; createdAt: number };
type Detail = {
  client: {
    id: string;
    kind: "individual" | "couple" | "business";
    name: string;
    email: string;
    phone: string;
    spouseName: string;
    spouseEmail: string;
    company: string;
    tags: string[];
    assignedTo: string | null;
    notes: string;
    invitedAt: number | null;
    lastLoginAt: number | null;
    createdAt: number;
    archived: boolean;
    outstanding: number;
    overdue: number;
  };
  engagements: { id: string; year: number; service: string; status: Stage; dueDate: string | null }[];
  requests: Req[];
  files: File[];
  messages: Msg[];
  schedules: { id: string; every: string; title: string; nextRunAt: number; active: boolean }[];
  events: { kind: string; detail: string; title: string; createdAt: number }[];
  portal: { url: string };
};

const TABS = ["overview", "requests", "documents", "messages", "activity"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", requests: "Requests", documents: "Documents", messages: "Messages", activity: "Activity" };
const money = (cents: number, cur = "usd") => new Intl.NumberFormat(undefined, { style: "currency", currency: cur.toUpperCase() }).format(cents / 100);

const EVENT: Record<string, string> = {
  created: "Request created",
  emailed: "Request emailed",
  email_failed: "Email not sent",
  code_sent: "Sign-in code emailed",
  verified: "Client opened the request",
  verify_failed: "Wrong code entered",
  locked: "Locked after wrong codes",
  uploaded: "Uploaded",
  submitted: "Client finished the request",
  returned: "Sent back for a new copy",
  reminded: "Reminder",
  extended: "Link extended",
  cancelled: "Cancelled",
  not_applicable: "Marked “doesn't apply”",
  na_undone: "“Doesn't apply” undone",
  ai_ok: "Checked automatically",
  ai_flagged: "Check found a problem",
};

export function ClientProfile({ wid, cid }: { wid: string; cid: string }) {
  const params = useSearchParams();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [year, setYear] = useState(seasonYear());
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [returning, setReturning] = useState<{ req: Req; item: Item } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/api/workspaces/${wid}/clients/${cid}`)
      .then(setD)
      .catch((e) => toast(errMsg(e), "error"));
  }, [wid, cid, toast]);
  useEffect(load, [load]);
  // Uploads are checked in the background: refresh while any check is running.
  useEffect(() => {
    if (!d?.requests.some((r) => r.items.some((i) => i.aiStatus === "checking"))) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [d, load]);
  useEffect(() => {
    if (tab === "messages" && d?.messages.some((m) => m.author === "client" && !m.readAt)) void api(`/api/workspaces/${wid}/clients/${cid}`, { method: "POST", json: { action: "read" } });
  }, [tab, d, wid, cid]);

  async function act(action: string, extra: Record<string, unknown> = {}, ok?: string) {
    setBusy(action);
    try {
      const r = await api<{ delivered?: boolean; mailError?: string | null; url?: string | null }>(`/api/workspaces/${wid}/clients/${cid}`, { method: "POST", json: { action, ...extra } });
      if (r.delivered === false) toast(`The email didn't go out${r.mailError ? `: ${r.mailError}` : "."}${r.url ? " You can copy the portal link instead." : ""}`, "error");
      else if (ok) toast(ok, "success");
      load();
      return r;
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  }
  async function reqAction(id: string, body: Record<string, unknown>, ok: string) {
    try {
      await api(`/api/requests/${id}`, { method: "POST", json: body });
      toast(ok, "success");
      load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  if (!d) return <div className="fa-loading"><span className="spinner spinner-lg" /></div>;
  const c = d.client;
  const p = portalStatus(c);
  const eng = d.engagements.find((e) => e.year === year);
  const stage = (eng?.status ?? "not_started") as Stage;
  const stageIdx = STAGES.findIndex((s) => s.key === stage);
  const open = d.requests.filter((r) => ["pending", "viewed", "in_progress"].includes(r.status));
  const outstanding = open.flatMap((r) => r.items.filter((i) => i.status === "needed" || i.status === "returned").map((i) => ({ ...i, req: r })));
  const received = d.requests.flatMap((r) => r.items.filter((i) => i.status === "uploaded").map((i) => ({ ...i, req: r }))).sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
  const unread = d.messages.filter((m) => m.author === "client" && !m.readAt).length;
  const years = [...new Set([...d.files.map((f) => f.year ?? 0), seasonYear()])].sort((a, b) => b - a);

  return (
    <div className="fa-page">
      <Link href={`/app/${wid}/clients/list`} className="fa-back">
        <I.left size={14} /> All clients
      </Link>
      <div className="fa-card fa-hero">
        <div className="fa-hero-top">
          <Avatar name={c.company || c.name} size={56} />
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 className="ellipsis">{c.company || c.name}</h1>
            <div className="fa-meta">
              <span>{CLIENT_KINDS.find((k) => k.key === c.kind)?.label}</span>
              {c.company && <span>{c.name}</span>}
              {c.spouseName && <span>with {c.spouseName}</span>}
              <a href={`mailto:${c.email}`}>{c.email}</a>
              {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
              <span>
                <span className={`fa-dot tone-${p.tone}`} /> Portal: {p.label}
              </span>
            </div>
            {c.tags.length > 0 && (
              <div className="fa-tags" style={{ marginTop: 8 }}>
                {c.tags.map((t) => (
                  <span key={t} className="fa-tag">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="fa-hero-actions">
            <button className="btn btn-primary" disabled={c.archived} onClick={() => setRequesting(true)}>
              <I.inbox size={15} /> Request documents
            </button>
            <button className="btn" disabled={busy === "invite" || c.archived} onClick={() => act("invite", {}, c.invitedAt || c.lastLoginAt ? "Sign-in link sent again." : `Invitation sent to ${c.email}.`)}>
              <I.mail size={15} /> {c.invitedAt || c.lastLoginAt ? "Resend invite" : "Invite to portal"}
            </button>
            {c.outstanding > 0 && (
              <button className="btn" disabled={busy === "remind"} onClick={() => act("remind", {}, "Reminder sent.")}>
                <I.bell size={15} /> Remind
              </button>
            )}
            <MoreMenu
              items={[
                { label: "Edit details", onClick: () => setEditing(true) },
                { label: "Share a document", onClick: () => setSharing(true) },
                { label: "Copy portal link", onClick: () => (void navigator.clipboard.writeText(d.portal.url), toast("Portal link copied.", "success")) },
                c.archived
                  ? { label: "Restore client", onClick: () => act("archive", { archived: false }, "Client restored.") }
                  : { label: "Archive client", danger: true, onClick: () => window.confirm(`Archive ${c.name}? They lose portal access; their documents stay in your library.`) && act("archive", { archived: true }, "Client archived.") },
              ]}
            />
          </div>
        </div>

        <div className="fa-stepper-wrap">
          <div className="row between wrap gap-8">
            <span className="fa-label" style={{ margin: 0 }}>
              {eng?.service ?? "Tax return"} ·{" "}
              <select className="fa-inline-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
                {[seasonYear() + 1, seasonYear(), seasonYear() - 1, seasonYear() - 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </span>
            <span className="small muted">Click a step to move the client along.</span>
          </div>
          <ol className="fa-stepper">
            {STAGES.map((s, i) => (
              <li key={s.key} className={i < stageIdx ? "done" : i === stageIdx ? "on" : ""}>
                <button onClick={() => act("stage", { year, status: s.key })} disabled={c.archived}>
                  <span className="fa-step-dot">{i < stageIdx ? <I.check size={12} /> : i + 1}</span>
                  <span className="fa-step-label">{s.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="fa-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === "requests" && open.length > 0 && <span className="fa-count">{open.length}</span>}
            {t === "messages" && unread > 0 && <span className="fa-count hot">{unread}</span>}
            {t === "documents" && d.files.length > 0 && <span className="fa-count">{d.files.length}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="fa-cols">
          <div className="col gap-16">
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Still needed</h2>
                {outstanding.length > 0 && <span className="small muted">{outstanding.length} item{outstanding.length === 1 ? "" : "s"}</span>}
              </div>
              {outstanding.length ? (
                <ul className="fa-checklist">
                  {outstanding.map((i) => (
                    <li key={i.id}>
                      <span className={`fa-check-ico ${i.status}`}>{i.status === "returned" ? <I.undo size={13} /> : null}</span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="ellipsis" style={{ display: "block" }}>{i.label}</span>
                        <span className="small muted">
                          {i.req.title}
                          {i.status === "returned" && i.feedback ? ` · sent back: ${i.feedback}` : ""}
                          {i.req.dueDate ? ` · due ${fmtDate(i.req.dueDate)}` : ""}
                        </span>
                      </span>
                      {!i.required && <span className="fa-chip tone-muted">Optional</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={<I.check size={22} />} title={open.length ? "Everything's in" : "Nothing requested yet"} body={open.length ? undefined : "Send a checklist and track every document here."}>
                  {!open.length && !c.archived && (
                    <button className="btn btn-primary btn-sm" onClick={() => setRequesting(true)}>
                      Request documents
                    </button>
                  )}
                </Empty>
              )}
            </div>
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Recently received</h2>
              </div>
              {received.length ? (
                <ul className="fa-checklist">
                  {received.slice(0, 8).map((i) => (
                    <li key={i.id}>
                      <span className="fa-check-ico uploaded"><I.check size={13} /></span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="ellipsis" style={{ display: "block" }}>{i.ai?.summary || i.label}</span>
                        <span className="small muted">{i.label} · {i.uploadedAt ? timeAgo(i.uploadedAt) : ""}</span>
                        <AiNote item={i} />
                      </span>
                      {i.documentId && (
                        <Link className="btn btn-sm btn-ghost" href={`/app/${wid}?doc=${i.documentId}`}>
                          Open
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small fa-pad">Uploads appear here as they arrive, already checked and named.</p>
              )}
            </div>
          </div>
          <div className="col gap-16">
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Notes</h2>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>Edit</button>
              </div>
              <p className="fa-notes">{c.notes || <span className="faint">No notes yet. Only your team sees these.</span>}</p>
            </div>
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Recurring requests</h2>
              </div>
              {d.schedules.length ? (
                <ul className="fa-checklist">
                  {d.schedules.map((s) => (
                    <li key={s.id}>
                      <span className="fa-check-ico uploaded"><I.history size={13} /></span>
                      <span className="grow">
                        {s.title}
                        <span className="small muted" style={{ display: "block" }}>
                          Every {s.every} · next {fmtDate(s.nextRunAt)}
                        </span>
                      </span>
                      <button className="btn btn-sm btn-ghost" onClick={() => window.confirm("Stop this recurring request?") && act("stop_schedule", { scheduleId: s.id }, "Recurring request stopped.")}>
                        Stop
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small fa-pad">For bookkeeping clients: choose “Every month” when you send a request and it goes out automatically.</p>
              )}
            </div>
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Client since</h2>
              </div>
              <p className="fa-pad small" style={{ margin: 0 }}>
                {fmtDate(c.createdAt)}
                {c.lastLoginAt ? ` · last signed in ${timeAgo(c.lastLoginAt)}` : c.invitedAt ? ` · invited ${timeAgo(c.invitedAt)}, hasn't signed in yet` : " · not invited to the portal yet"}
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="col gap-16">
          {!d.requests.length && (
            <div className="fa-card">
              <Empty icon={<I.inbox size={26} />} title="No requests yet" body="Send a checklist built from a template or from last year's return.">
                <button className="btn btn-primary btn-sm" onClick={() => setRequesting(true)}>Request documents</button>
              </Empty>
            </div>
          )}
          {d.requests.map((r) => {
            const done = r.received + r.notApplicable;
            const isOpen = ["pending", "viewed", "in_progress"].includes(r.status);
            return (
              <div key={r.id} className="fa-card fa-req">
                <div className="fa-req-head">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3 className="ellipsis">{r.title}</h3>
                    <div className="small muted">
                      {r.year ? `Tax year ${r.year} · ` : ""}Sent {fmtDate(r.createdAt)}
                      {r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ""}
                      {r.viewedAt ? ` · opened ${timeAgo(r.viewedAt)}` : " · not opened yet"}
                      {r.lastRemindedAt ? ` · reminded ${timeAgo(r.lastRemindedAt)}` : ""}
                    </div>
                  </div>
                  <span className={`fa-chip tone-${r.status === "complete" ? "good" : r.status === "expired" ? "bad" : isOpen ? "warn" : "muted"}`}>
                    {r.status === "complete" ? "Complete" : r.status === "expired" ? "Expired" : r.status === "cancelled" ? "Cancelled" : r.status === "pending" ? "Sent" : "In progress"}
                  </span>
                </div>
                <div className="fa-progress">
                  <span className="fa-progress-bar"><i style={{ width: `${r.total ? (done / r.total) * 100 : 0}%` }} /></span>
                  <span className="small">
                    {done} of {r.total}
                  </span>
                </div>
                <ul className="fa-checklist">
                  {r.items.map((i) => (
                    <li key={i.id}>
                      <span className={`fa-check-ico ${i.status}`}>{i.status === "uploaded" ? <I.check size={13} /> : i.status === "na" ? <I.x size={12} /> : i.status === "returned" ? <I.undo size={13} /> : null}</span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span style={{ display: "block" }} className={i.status === "na" ? "faint" : ""}>
                          {i.label}
                          {!i.required && <span className="faint small"> · optional</span>}
                        </span>
                        {i.status === "na" && <span className="small muted">Doesn’t apply: {i.naReason}</span>}
                        {i.status === "returned" && <span className="small fa-red">Sent back: {i.feedback}</span>}
                        {i.status === "uploaded" && <AiNote item={i} />}
                      </span>
                      {i.status === "uploaded" && i.documentId && (
                        <span className="row gap-4">
                          <Link className="btn btn-sm btn-ghost" href={`/app/${wid}?doc=${i.documentId}`}>Open</Link>
                          {isOpen || r.status === "complete" ? (
                            <button className="btn btn-sm btn-ghost" onClick={() => setReturning({ req: r, item: i })}>Send back</button>
                          ) : null}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="fa-req-foot">
                  {isOpen && (
                    <button className="btn btn-sm" onClick={() => act("remind", {}, "Reminder sent.")}>
                      <I.bell size={14} /> Remind
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(r.link);
                      toast("Upload link copied.", "success");
                    }}
                  >
                    <I.link size={14} /> Copy upload link
                  </button>
                  {isOpen && (
                    <button className="btn btn-sm btn-ghost" onClick={() => window.confirm("Cancel this request? The client won't be able to upload to it anymore.") && reqAction(r.id, { action: "cancel" }, "Request cancelled.")}>
                      Cancel request
                    </button>
                  )}
                  {r.status === "expired" && (
                    <button className="btn btn-sm" onClick={() => reqAction(r.id, { action: "extend", days: 30 }, "Extended by 30 days.")}>
                      Extend 30 days
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "documents" && (
        <div className="col gap-16">
          <div className="row between wrap gap-8">
            <p className="muted small" style={{ margin: 0 }}>
              Everything {c.name.split(" ")[0]} uploaded, and what you’ve shared with them, filed by tax year.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setSharing(true)}>
              <I.upload size={14} /> Share a document
            </button>
          </div>
          {!d.files.length ? (
            <div className="fa-card">
              <Empty icon={<I.folder size={26} />} title="No documents yet" body="Uploads from requests land here automatically. Share finished returns and letters from here too." />
            </div>
          ) : (
            years
              .filter((y) => d.files.some((f) => (f.year ?? 0) === y))
              .map((y) => {
                const files = d.files.filter((f) => (f.year ?? 0) === y);
                return (
                  <div key={y} className="fa-card">
                    <div className="fa-card-head">
                      <h2>{y ? `Tax year ${y}` : "No year"}</h2>
                      {y > 0 && (
                        <a className="btn btn-sm btn-tonal" href={`/api/workspaces/${wid}/clients/${cid}/files?year=${y}`} title="The amounts read from this year's forms, in one spreadsheet">
                          <I.table size={14} /> Summary (Excel)
                        </a>
                      )}
                    </div>
                    <ul className="fa-files">
                      {files.map((f) => (
                        <li key={f.id}>
                          <span className={`fa-file-ico ${f.source}`}>
                            <I.file size={16} />
                          </span>
                          <span className="grow" style={{ minWidth: 0 }}>
                            <Link href={`/app/${wid}?doc=${f.documentId}`} className="ellipsis" style={{ display: "block", fontWeight: 500 }}>
                              {f.name}
                            </Link>
                            <span className="small muted">
                              {f.source === "client" ? "From client" : "Shared by you"} · {f.ai?.formType && f.ai.formType !== "Other" ? f.ai.formType : f.category || "Document"} · {timeAgo(f.createdAt)}
                              {f.source === "firm" && (f.clientViewedAt ? ` · opened ${timeAgo(f.clientViewedAt)}` : " · not opened yet")}
                            </span>
                            {f.pay && <span className={`fa-chip tone-${f.pay.paidAt ? "good" : "warn"}`}>{f.pay.paidAt ? `Paid ${money(f.pay.cents, f.pay.currency)}` : `Unlocks after payment · ${money(f.pay.cents, f.pay.currency)}`}</span>}
                            {f.ai?.problems?.length ? <span className="small fa-red" style={{ display: "block" }}>{f.ai.problems[0]}</span> : null}
                          </span>
                          {f.source === "firm" && (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={async () => {
                                await api(`/api/workspaces/${wid}/clients/${cid}/files/${f.id}`, { method: "PATCH", json: { shared: !f.shared } });
                                load();
                              }}
                            >
                              {f.shared ? "Unshare" : "Share"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
          )}
        </div>
      )}

      {tab === "messages" && <Thread wid={wid} cid={cid} messages={d.messages} clientName={c.name} onSent={load} />}

      {tab === "activity" && (
        <div className="fa-card">
          {d.events.length ? (
            <ul className="fa-timeline">
              {d.events.map((e, i) => (
                <li key={i}>
                  <span className="fa-tl-dot" />
                  <span className="grow">
                    <b>{EVENT[e.kind] ?? e.kind}</b> <span className="muted">· {e.title}</span>
                    {e.detail && <span className="small muted" style={{ display: "block" }}>{e.detail}</span>}
                  </span>
                  <span className="small faint" style={{ whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small fa-pad">Every email, sign-in, upload and reminder is recorded here, with the time.</p>
          )}
        </div>
      )}

      {editing && (
        <ClientFormModal
          wid={wid}
          clientId={cid}
          client={{ ...c, assignedTo: c.assignedTo } as Partial<ClientFields>}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
      {requesting && (
        <RequestBuilder
          wid={wid}
          target={{ kind: "one", id: cid, name: c.name }}
          onClose={() => setRequesting(false)}
          onSent={() => {
            setRequesting(false);
            setTab("requests");
            load();
          }}
        />
      )}
      {sharing && (
        <ShareModal
          wid={wid}
          cid={cid}
          name={c.name}
          onClose={() => setSharing(false)}
          onDone={() => {
            setSharing(false);
            setTab("documents");
            load();
          }}
        />
      )}
      {returning && (
        <ReturnModal
          item={returning.item}
          onClose={() => setReturning(null)}
          onSend={(feedback) =>
            reqAction(returning.req.id, { action: "return", itemId: returning.item.id, feedback }, "Sent back to the client with your note.").then(() => setReturning(null))
          }
        />
      )}
      {c.archived && <div className="fa-banner" style={{ marginTop: 16 }}><I.lock size={16} /> This client is archived. Restore them to send requests or messages.</div>}
    </div>
  );
}

function AiNote({ item }: { item: Pick<Item, "aiStatus" | "ai"> }) {
  if (item.aiStatus === "checking")
    return (
      <span className="fa-ai checking">
        <span className="spinner" /> Checking…
      </span>
    );
  if (item.aiStatus === "flagged" && item.ai)
    return (
      <span className="fa-ai flagged">
        <I.info size={13} /> {item.ai.problems.join(" ")}
      </span>
    );
  if (item.aiStatus === "ok" && item.ai)
    return (
      <span className="fa-ai ok">
        <I.check size={13} /> {item.ai.summary}
      </span>
    );
  return null;
}

function MoreMenu({ items }: { items: { label: string; onClick: () => unknown; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn" aria-label="More" onClick={() => setOpen((o) => !o)}>
        <I.more size={16} />
      </button>
      {open && (
        <div className="menu">
          {items.map((it) => (
            <button
              key={it.label}
              className="menu-item"
              style={it.danger ? { color: "var(--bad)" } : undefined}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Thread({ wid, cid, messages, clientName, onSent }: { wid: string; cid: string; messages: Msg[]; clientName: string; onSent: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  async function send() {
    setBusy(true);
    try {
      await api(`/api/workspaces/${wid}/clients/${cid}`, { method: "POST", json: { action: "message", body: text, internal } });
      setText("");
      onSent();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fa-card fa-thread">
      <div className="fa-msgs">
        {!messages.length && <Empty icon={<I.chat size={24} />} title="No messages yet" body={`Messages are private: ${clientName.split(" ")[0]} reads them in the portal, and gets an email that there's something new (never the message itself).`} />}
        {messages.map((m) => (
          <div key={m.id} className={`fa-msg ${m.author} ${m.internal ? "internal" : ""}`}>
            <div className="fa-msg-meta">
              <b>{m.authorName}</b> · {timeAgo(m.createdAt)}
              {m.internal && <span className="fa-chip tone-warn">Internal note</span>}
            </div>
            <div className="fa-msg-body">{m.body}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className={`fa-compose ${internal ? "internal" : ""}`}>
        <textarea
          className="textarea"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={internal ? "Note for your team (the client won't see it)" : `Message ${clientName.split(" ")[0]}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void send();
          }}
        />
        <div className="row between wrap gap-8">
          <label className="check small">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
          </label>
          <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={send}>
            {busy ? "Sending…" : internal ? "Add note" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ wid, cid, name, onClose, onDone }: { wid: string; cid: string; name: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<globalThis.File | null>(null);
  const [year, setYear] = useState(seasonYear());
  const [category, setCategory] = useState("Tax return");
  const [charge, setCharge] = useState(false);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!file) return;
    setBusy(true);
    try {
      const f = new FormData();
      f.append("file", file);
      f.append("year", String(year));
      f.append("category", category);
      if (charge && Number(amount) > 0) {
        f.append("payAmount", amount);
        f.append("payDescription", desc || `${category} ${year}`);
      }
      await api(`/api/workspaces/${wid}/clients/${cid}/files`, { method: "POST", body: f });
      toast(`Shared with ${name}. They've been emailed.`, "success");
      onDone();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Share a document with ${name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!file || busy} onClick={send}>
            {busy ? "Sharing…" : "Share"}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <label className="fa-drop">
          <I.upload size={22} />
          <b>{file ? file.name : "Choose a file"}</b>
          <span className="small muted">PDF, Word, Excel or an image</span>
          <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="fa-grid2">
          <div className="field">
            <label htmlFor="sh-cat">What it is</label>
            <select id="sh-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {["Tax return", "Engagement letter", "Organizer", "Financial statements", "IRS notice", "Invoice", "Other"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sh-year">Tax year</label>
            <select id="sh-year" className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[seasonYear() + 1, seasonYear(), seasonYear() - 1, seasonYear() - 2].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
          <span>
            <b>Unlock after payment</b>
            <br />
            <span className="small muted">The client sees the document but can download it once they’ve paid your invoice online (paid to your Stripe account; connect it in Settings → Integrations).</span>
          </span>
        </label>
        {charge && (
          <div className="fa-grid2">
            <div className="field">
              <label htmlFor="sh-amt">Amount (USD)</label>
              <input id="sh-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="350.00" />
            </div>
            <div className="field">
              <label htmlFor="sh-desc">Invoice description</label>
              <input id="sh-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={`${category} ${year}`} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReturnModal({ item, onClose, onSend }: { item: Item; onClose: () => void; onSend: (feedback: string) => void }) {
  const suggestion = item.ai?.problems?.[0] ?? "";
  const [text, setText] = useState(suggestion);
  return (
    <Modal
      title={`Ask for a new copy: ${item.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onSend(text.trim())}>
            Send back
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rt-note">What’s wrong? The client sees this note.</label>
        <textarea id="rt-note" className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="This is the 2024 form; we need the one for 2025." />
      </div>
    </Modal>
  );
}
