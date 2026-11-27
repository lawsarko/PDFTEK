"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import { STAGES, seasonYear, type Stage } from "@/lib/client-shared";
import { I } from "../icons";
import { useToast } from "../toast";
import { PageHead } from "./shell";
import { Avatar, Empty, StageChip } from "./ui";
import { ClientFormModal, ImportModal } from "./client-form";
import { RequestBuilder } from "./request-builder";

export type ClientRowDTO = {
  id: string;
  kind: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  tags: string[];
  assignedTo: string | null;
  invitedAt: number | null;
  lastLoginAt: number | null;
  openRequests: number;
  outstanding: number;
  overdue: number;
  flagged: number;
  lastActivityAt: number;
  lastRemindedAt: number | null;
  stage: Stage;
  archived: boolean;
};

type Filter = "all" | "waiting" | "overdue" | "review" | "not_invited";

export function portalStatus(c: Pick<ClientRowDTO, "lastLoginAt" | "invitedAt">) {
  if (c.lastLoginAt) return { label: `Active ${timeAgo(c.lastLoginAt)}`, tone: "good" };
  if (c.invitedAt) return { label: "Invited", tone: "info" };
  return { label: "Not invited", tone: "muted" };
}

export function Directory({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [year, setYear] = useState(seasonYear());
  const [list, setList] = useState<ClientRowDTO[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>((params.get("filter") as Filter) || "all");
  const [stage, setStage] = useState<Stage | "">((params.get("stage") as Stage) || "");
  const [tag, setTag] = useState("");
  const [view, setView] = useState<"table" | "board">(params.get("view") === "board" ? "board" : "table");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [requesting, setRequesting] = useState<null | { kind: "many"; ids: string[] } | { kind: "tag"; tag: string; count: number }>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ clients: ClientRowDTO[] }>(`/api/workspaces/${wid}/clients?year=${year}${archived ? "&archived=1" : ""}`)
      .then((r) => setList(r.clients))
      .catch((e) => toast(errMsg(e), "error"));
  }, [wid, year, archived, toast]);
  useEffect(load, [load]);

  const tags = useMemo(() => [...new Set((list ?? []).flatMap((c) => c.tags))].sort(), [list]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter(
      (c) =>
        (!s || `${c.name} ${c.email} ${c.company} ${c.phone} ${c.tags.join(" ")}`.toLowerCase().includes(s)) &&
        (!stage || c.stage === stage) &&
        (!tag || c.tags.includes(tag)) &&
        (filter === "all" ||
          (filter === "waiting" && c.outstanding > 0) ||
          (filter === "overdue" && c.overdue > 0) ||
          (filter === "review" && (c.flagged > 0 || c.stage === "docs_in")) ||
          (filter === "not_invited" && !c.invitedAt && !c.lastLoginAt)),
    );
  }, [list, q, stage, tag, filter]);

  async function moveStage(id: string, to: Stage) {
    setList((l) => l?.map((c) => (c.id === id ? { ...c, stage: to } : c)) ?? l);
    try {
      await api(`/api/workspaces/${wid}/clients/${id}`, { method: "POST", json: { action: "stage", year, status: to } });
    } catch (e) {
      toast(errMsg(e), "error");
      load();
    }
  }
  async function remindPicked() {
    let ok = 0;
    for (const id of picked) {
      const c = list?.find((x) => x.id === id);
      if (!c?.outstanding) continue;
      try {
        if ((await api<{ delivered: boolean }>(`/api/workspaces/${wid}/clients/${id}`, { method: "POST", json: { action: "remind" } })).delivered) ok++;
      } catch {}
    }
    toast(ok ? `Reminded ${ok} client${ok === 1 ? "" : "s"}.` : "None of the selected clients have anything outstanding.", ok ? "success" : "info");
    load();
  }
  async function invitePicked() {
    let ok = 0;
    for (const id of picked) {
      try {
        if ((await api<{ delivered: boolean }>(`/api/workspaces/${wid}/clients/${id}`, { method: "POST", json: { action: "invite" } })).delivered) ok++;
      } catch (e) {
        toast(errMsg(e), "error");
      }
    }
    toast(`Invited ${ok} client${ok === 1 ? "" : "s"} to the portal.`, ok ? "success" : "error");
    load();
  }
  const togglePick = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const allPicked = shown.length > 0 && shown.every((c) => picked.has(c.id));

  return (
    <div className="fa-page">
      <PageHead title="Clients" sub={list ? `${list.length} ${archived ? "archived" : "active"} client${list.length === 1 ? "" : "s"}` : undefined}>
        <button className="btn" onClick={() => setImporting(true)}>
          <I.upload size={15} /> Import
        </button>
        {tag && (
          <button className="btn btn-tonal" onClick={() => setRequesting({ kind: "tag", tag, count: (list ?? []).filter((c) => c.tags.includes(tag)).length })}>
            <I.inbox size={15} /> Request from “{tag}”
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <I.plus size={15} /> Add client
        </button>
      </PageHead>

      <div className="fa-toolbar">
        <div className="fa-search">
          <I.search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, company or tag" aria-label="Search clients" />
        </div>
        <div className="fa-chips">
          {(
            [
              ["all", "All"],
              ["waiting", "Waiting on client"],
              ["overdue", "Overdue"],
              ["review", "Ready for review"],
              ["not_invited", "Not invited"],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} className={`fa-chip-btn ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
              {filter === k && <I.check size={13} />} {label}
            </button>
          ))}
        </div>
        <div className="fa-toolbar-end">
          <select className="select input-sm" value={stage} onChange={(e) => setStage(e.target.value as Stage | "")} aria-label="Stage">
            <option value="">Every stage</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {tags.length > 0 && (
            <select className="select input-sm" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">Every tag</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <select className="select input-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
            {[seasonYear() + 1, seasonYear(), seasonYear() - 1, seasonYear() - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <div className="fa-segment small" role="tablist" aria-label="View">
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")} aria-label="Table">
              <I.table size={15} />
            </button>
            <button className={view === "board" ? "on" : ""} onClick={() => setView("board")} aria-label="Board">
              <I.layers size={15} />
            </button>
          </div>
        </div>
      </div>

      {picked.size > 0 && (
        <div className="fa-selbar">
          <b>{picked.size} selected</b>
          <button className="btn btn-sm btn-primary" onClick={() => setRequesting({ kind: "many", ids: [...picked] })}>
            <I.inbox size={14} /> Request documents
          </button>
          <button className="btn btn-sm" onClick={remindPicked}>
            <I.bell size={14} /> Remind
          </button>
          <button className="btn btn-sm" onClick={invitePicked}>
            <I.mail size={14} /> Invite to portal
          </button>
          <span className="grow" />
          <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {!list ? (
        <div className="fa-loading"><span className="spinner spinner-lg" /></div>
      ) : !list.length ? (
        <div className="fa-card">
          <Empty icon={<I.users size={28} />} title={archived ? "No archived clients" : "No clients yet"} body={archived ? undefined : "Add your clients one by one, or import your list from a spreadsheet."}>
            {!archived && (
              <>
                <button className="btn btn-primary" onClick={() => setAdding(true)}><I.plus size={15} /> Add client</button>
                <button className="btn" onClick={() => setImporting(true)}><I.upload size={15} /> Import</button>
              </>
            )}
          </Empty>
        </div>
      ) : view === "table" ? (
        <div className="fa-card fa-table-card">
          <table className="fa-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((c) => c.id)))} aria-label="Select all" />
                </th>
                <th>Client</th>
                <th>Stage</th>
                <th>Documents</th>
                <th className="hide-mobile">Portal</th>
                <th className="hide-mobile">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const p = portalStatus(c);
                return (
                  <tr key={c.id} className={picked.has(c.id) ? "on" : ""} onClick={() => router.push(`/app/${wid}/clients/${c.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} aria-label={`Select ${c.name}`} />
                    </td>
                    <td>
                      <div className="fa-who">
                        <Avatar name={c.company || c.name} size={34} />
                        <span style={{ minWidth: 0 }}>
                          <Link href={`/app/${wid}/clients/${c.id}`} className="fa-who-name ellipsis" onClick={(e) => e.stopPropagation()}>
                            {c.company || c.name}
                          </Link>
                          <span className="small muted ellipsis">{c.company ? `${c.name} · ${c.email}` : c.email}</span>
                          {c.tags.length > 0 && (
                            <span className="fa-tags">
                              {c.tags.slice(0, 3).map((t) => (
                                <span key={t} className="fa-tag">{t}</span>
                              ))}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select className={`fa-stage-select tone-${STAGES.find((s) => s.key === c.stage)?.tone}`} value={c.stage} onChange={(e) => moveStage(c.id, e.target.value as Stage)} aria-label="Stage">
                        {STAGES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {c.outstanding ? (
                        <span className="fa-docs">
                          <b>{c.outstanding}</b> outstanding
                          {c.overdue > 0 && <span className="fa-chip tone-bad">Overdue</span>}
                        </span>
                      ) : c.openRequests ? (
                        <span className="fa-chip tone-good">All in</span>
                      ) : (
                        <span className="faint small">No open requests</span>
                      )}
                      {c.flagged > 0 && <span className="fa-chip tone-warn" title="The automatic check found something to look at">{c.flagged} to check</span>}
                    </td>
                    <td className="hide-mobile">
                      <span className={`fa-dot tone-${p.tone}`} /> <span className="small">{p.label}</span>
                    </td>
                    <td className="hide-mobile small muted">{timeAgo(c.lastActivityAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p className="muted small fa-pad">No clients match these filters.</p>}
        </div>
      ) : (
        <div className="fa-board">
          {STAGES.map((s) => {
            const cards = shown.filter((c) => c.stage === s.key);
            return (
              <div
                key={s.key}
                className={`fa-col ${dragging ? "drop" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setDragging(null);
                  if (id) void moveStage(id, s.key);
                }}
              >
                <div className="fa-col-head">
                  <StageChip stage={s.key} />
                  <span className="faint small">{cards.length}</span>
                </div>
                {cards.map((c) => (
                  <Link
                    key={c.id}
                    href={`/app/${wid}/clients/${c.id}`}
                    className="fa-bcard"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.id);
                      setDragging(c.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                  >
                    <span className="row gap-8">
                      <Avatar name={c.company || c.name} size={28} />
                      <b className="ellipsis grow">{c.company || c.name}</b>
                    </span>
                    <span className="small muted">
                      {c.outstanding ? `${c.outstanding} outstanding` : c.openRequests ? "All documents in" : "No open requests"}
                      {c.overdue ? " · overdue" : ""}
                    </span>
                    {c.tags.length > 0 && (
                      <span className="fa-tags">
                        {c.tags.slice(0, 2).map((t) => (
                          <span key={t} className="fa-tag">{t}</span>
                        ))}
                      </span>
                    )}
                  </Link>
                ))}
                {!cards.length && <div className="fa-col-empty">Drop a client here</div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setArchived((a) => !a)}>
          {archived ? "Show active clients" : "Show archived clients"}
        </button>
      </div>

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
      {requesting && (
        <RequestBuilder
          wid={wid}
          target={requesting}
          onClose={() => setRequesting(null)}
          onSent={() => {
            setRequesting(null);
            setPicked(new Set());
            load();
          }}
        />
      )}
    </div>
  );
}
