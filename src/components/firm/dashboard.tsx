"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import { STAGES, seasonYear } from "@/lib/client-shared";
import { I } from "../icons";
import { useToast } from "../toast";
import { notifyPaywall } from "../paywall";
import { PageHead, useFirm } from "./shell";
import { Avatar, Empty, Kpi, daysUntil, fmtShort } from "./ui";
import { ClientFormModal, ImportModal } from "./client-form";
import type { ClientRowDTO } from "./directory";

type Dash = {
  year: number;
  locked: boolean;
  kpis: { clients: number; waiting: number; overdue: number; receivedToday: number; needsReview: number; readyToSign: number; unread: number };
  stages: Record<string, number>;
  nudge: ClientRowDTO[];
  upcoming: { date: string; label: string; clientId: string }[];
  deadlines: { date: string; label: string }[];
  activity: { kind: string; who: string; what: string; clientId: string; at: number }[];
  plan: { limit: number | null; used: number };
  portalUrl: string;
};

const FEED: Record<string, [string, React.ReactNode]> = {
  uploaded: ["uploaded", <I.upload key="u" size={15} />],
  submitted: ["finished a request", <I.check key="c" size={15} />],
  not_applicable: ["marked an item as not applicable", <I.x key="x" size={15} />],
  verified: ["opened a request", <I.lock key="l" size={15} />],
  returned: ["was asked for a new copy", <I.undo key="r" size={15} />],
  reminded: ["was reminded", <I.bell key="b" size={15} />],
  message: ["sent a message", <I.chat key="m" size={15} />],
};

export function Dashboard({ wid }: { wid: string }) {
  const router = useRouter();
  const toast = useToast();
  const { firm } = useFirm();
  const [d, setD] = useState<Dash | null>(null);
  const [year, setYear] = useState(seasonYear());
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [nudging, setNudging] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Dash>(`/api/workspaces/${wid}/clients/dashboard?year=${year}`).then(setD).catch((e) => toast(errMsg(e), "error"));
  }, [wid, year, toast]);
  useEffect(load, [load]);

  async function nudge(ids: string[]) {
    setNudging(ids.length > 1 ? "all" : ids[0]);
    let ok = 0;
    for (const id of ids) {
      try {
        const r = await api<{ delivered: boolean }>(`/api/workspaces/${wid}/clients/${id}`, { method: "POST", json: { action: "remind" } });
        if (r.delivered) ok++;
      } catch (e) {
        toast(errMsg(e), "error");
      }
    }
    setNudging(null);
    toast(ok ? `Reminder sent to ${ok} client${ok === 1 ? "" : "s"}.` : "No reminders were emailed (is email set up?).", ok ? "success" : "error");
    load();
  }

  if (!d) return <div className="fa-loading"><span className="spinner spinner-lg" /></div>;
  const greet = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const add = () => (d.locked ? notifyPaywall({ code: "membership_required", message: "Clients comes with pdftek Pro (up to 50 clients) or Team (unlimited clients)." }) : setAdding(true));

  return (
    <div className="fa-page">
      <PageHead title={`${greet}`} sub={firm ? `Here's where ${firm.name}'s clients stand for the ${d.year} tax year.` : undefined}>
        <select className="select fa-year" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
          {[seasonYear() + 1, seasonYear(), seasonYear() - 1, seasonYear() - 2].map((y) => (
            <option key={y} value={y}>
              Tax year {y}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => (d.locked ? add() : setImporting(true))}>
          <I.upload size={15} /> Import
        </button>
        <button className="btn btn-primary" onClick={add}>
          <I.plus size={15} /> Add client
        </button>
      </PageHead>

      {d.locked && (
        <div className="fa-banner">
          <I.lock size={18} />
          <span className="grow">Clients comes with pdftek <b>Pro</b> (up to 50 clients) or <b>Team</b> (unlimited). Client accounts are always free for your clients.</span>
          <Link href="/pricing" className="btn btn-primary btn-sm">See plans</Link>
        </div>
      )}

      {d.kpis.clients === 0 ? (
        <div className="fa-card fa-welcome">
          <div className="fa-welcome-art" aria-hidden>
            <span className="fa-welcome-dot a" />
            <span className="fa-welcome-dot b" />
            <I.users size={40} />
          </div>
          <h2>Bring your clients on board</h2>
          <p>Add your clients, then request their documents in a couple of clicks. They get a secure portal at <b>{firm?.host ?? "your firm's address"}</b>, sign in without a password, and upload from their phone. Every upload is checked, named and filed for you.</p>
          <ol className="fa-steps">
            <li><span>1</span>Add clients one by one, or import your list from a spreadsheet.</li>
            <li><span>2</span>Send a checklist: 1040, Schedule C, rentals, business, or built from last year’s return.</li>
            <li><span>3</span>Watch documents arrive here, checked and filed by year.</li>
          </ol>
          <div className="row gap-8 wrap center">
            <button className="btn btn-primary btn-lg" onClick={add}><I.plus size={16} /> Add your first client</button>
            <button className="btn btn-lg" onClick={() => (d.locked ? add() : setImporting(true))}><I.upload size={16} /> Import from a spreadsheet</button>
          </div>
        </div>
      ) : (
        <>
          <div className="fa-kpis">
            <Kpi label="Waiting on clients" value={d.kpis.waiting} hint="Have items outstanding" icon={<I.clock size={16} />} tone={d.kpis.waiting ? "warn" : undefined} onClick={() => router.push(`/app/${wid}/clients/list?filter=waiting`)} />
            <Kpi label="Overdue" value={d.kpis.overdue} hint="Past their due date" icon={<I.bell size={16} />} tone={d.kpis.overdue ? "bad" : undefined} onClick={() => router.push(`/app/${wid}/clients/list?filter=overdue`)} />
            <Kpi label="Received today" value={d.kpis.receivedToday} hint="Documents in the last 24 hours" icon={<I.inbox size={16} />} tone={d.kpis.receivedToday ? "good" : undefined} />
            <Kpi label="Ready for review" value={d.kpis.needsReview} hint="Documents in or flagged by the check" icon={<I.search size={16} />} tone={d.kpis.needsReview ? "info" : undefined} onClick={() => router.push(`/app/${wid}/clients/list?filter=review`)} />
            <Kpi label="Ready to sign" value={d.kpis.readyToSign} hint="Returns waiting on signatures" icon={<I.sign size={16} />} onClick={() => router.push(`/app/${wid}/clients/list?view=board`)} />
            <Kpi label="Unread messages" value={d.kpis.unread} hint="From clients" icon={<I.chat size={16} />} tone={d.kpis.unread ? "info" : undefined} onClick={() => router.push(`/app/${wid}/clients/messages`)} />
          </div>

          <div className="fa-card">
            <div className="fa-card-head">
              <h2>Pipeline</h2>
              <Link href={`/app/${wid}/clients/list?view=board`} className="small">Open the board →</Link>
            </div>
            <div className="fa-pipeline">
              {STAGES.map((s) => {
                const n = d.stages[s.key] ?? 0;
                const pct = d.kpis.clients ? (n / d.kpis.clients) * 100 : 0;
                return (
                  <Link key={s.key} href={`/app/${wid}/clients/list?stage=${s.key}`} className={`fa-pipe tone-${s.tone}`}>
                    <span className="fa-pipe-n">{n}</span>
                    <span className="fa-pipe-label">{s.label}</span>
                    <span className="fa-pipe-bar"><i style={{ width: `${Math.max(pct, n ? 6 : 0)}%` }} /></span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="fa-cols">
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Who to nudge today</h2>
                {d.nudge.length > 1 && (
                  <button className="btn btn-sm btn-tonal" disabled={!!nudging} onClick={() => nudge(d.nudge.map((c) => c.id))}>
                    {nudging === "all" ? "Sending…" : `Remind all ${d.nudge.length}`}
                  </button>
                )}
              </div>
              {d.nudge.length ? (
                <ul className="fa-list">
                  {d.nudge.map((c) => (
                    <li key={c.id}>
                      <Link href={`/app/${wid}/clients/${c.id}`} className="fa-list-main">
                        <Avatar name={c.name} size={34} />
                        <span className="grow" style={{ minWidth: 0 }}>
                          <b className="ellipsis">{c.name}</b>
                          <span className="small muted">
                            {c.outstanding} item{c.outstanding === 1 ? "" : "s"} outstanding
                            {c.overdue ? <span className="fa-red"> · overdue</span> : null}
                            {c.lastRemindedAt ? ` · reminded ${timeAgo(c.lastRemindedAt)}` : " · not reminded yet"}
                          </span>
                        </span>
                      </Link>
                      <button className="btn btn-sm" disabled={!!nudging} onClick={() => nudge([c.id])}>
                        {nudging === c.id ? "Sending…" : "Remind"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small fa-pad">Nobody needs a nudge right now. Clients with outstanding items show here 3 days after their last reminder.</p>
              )}
            </div>

            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Coming up</h2>
              </div>
              <ul className="fa-dates">
                {[...d.upcoming.map((u) => ({ ...u, kind: "request" })), ...d.deadlines.map((x) => ({ ...x, clientId: "", kind: "deadline" }))]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .slice(0, 7)
                  .map((x, i) => {
                    const days = daysUntil(x.date);
                    const body = (
                      <>
                        <span className={`fa-date ${days <= 7 ? "soon" : ""}`}>
                          <b>{fmtShort(x.date).split(" ")[1] ?? ""}</b>
                          <span>{fmtShort(x.date).split(" ")[0]}</span>
                        </span>
                        <span className="grow" style={{ minWidth: 0 }}>
                          <span className="ellipsis" style={{ display: "block" }}>{x.label}</span>
                          <span className="small muted">{x.kind === "deadline" ? "IRS deadline" : "Request due"} · {days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}</span>
                        </span>
                      </>
                    );
                    return <li key={i}>{x.clientId ? <Link href={`/app/${wid}/clients/${x.clientId}`}>{body}</Link> : <div>{body}</div>}</li>;
                  })}
              </ul>
            </div>
          </div>

          <div className="fa-cols">
            <div className="fa-card">
              <div className="fa-card-head">
                <h2>Latest activity</h2>
              </div>
              {d.activity.length ? (
                <ul className="fa-feed">
                  {d.activity.map((a, i) => (
                    <li key={i}>
                      <span className={`fa-feed-ico k-${a.kind}`}>{FEED[a.kind]?.[1] ?? <I.file size={15} />}</span>
                      <Link href={`/app/${wid}/clients/${a.clientId}`} className="grow" style={{ minWidth: 0 }}>
                        <span>
                          <b>{a.who}</b> {FEED[a.kind]?.[0] ?? a.kind}
                        </span>
                        <span className="small muted ellipsis" style={{ display: "block" }}>{a.what}</span>
                      </Link>
                      <span className="small faint" style={{ whiteSpace: "nowrap" }}>{timeAgo(a.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small fa-pad">Uploads, messages and finished requests will show up here as they happen.</p>
              )}
            </div>
            <div className="fa-card fa-portal-card">
              <div className="fa-card-head">
                <h2>Your client portal</h2>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>Clients sign in here with a code we email them. No passwords, nothing to install.</p>
              <div className="fa-url">
                <span className="ellipsis">{d.portalUrl.replace(/^https?:\/\//, "")}</span>
                <button
                  className="icon-btn"
                  aria-label="Copy link"
                  onClick={() => {
                    void navigator.clipboard.writeText(d.portalUrl);
                    toast("Portal link copied.", "success");
                  }}
                >
                  <I.copy size={15} />
                </button>
              </div>
              <div className="row gap-8 wrap" style={{ marginTop: 12 }}>
                <a className="btn btn-sm" href={firm && !firm.subdomains ? `/portal/${firm.slug}` : d.portalUrl} target="_blank" rel="noreferrer">Preview</a>
                <Link className="btn btn-sm btn-ghost" href={`/app/${wid}/clients/settings`}>Branding & address</Link>
              </div>
              {d.plan.limit !== null && (
                <div className="fa-usage">
                  <div className="row between small">
                    <span>Clients on Pro</span>
                    <b>{d.plan.used} of {d.plan.limit}</b>
                  </div>
                  <span className="fa-usage-bar"><i style={{ width: `${Math.min(100, (d.plan.used / d.plan.limit) * 100)}%` }} /></span>
                  {d.plan.used >= d.plan.limit * 0.8 && <Link href="/pricing" className="small">Unlimited clients with Team →</Link>}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {adding && <ClientFormModal wid={wid} onClose={() => setAdding(false)} onSaved={(id) => router.push(`/app/${wid}/clients/${id}`)} />}
      {importing && (
        <ImportModal
          wid={wid}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            load();
          }}
        />
      )}
    </div>
  );
}

export { Empty };
