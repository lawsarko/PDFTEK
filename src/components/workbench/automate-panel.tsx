"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import type { Member } from "@/lib/client/types";
import { I } from "../icons";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";

type Trigger =
  | { type: "document_uploaded"; nameContains?: string }
  | { type: "schedule"; time: string; days: number[]; tzOffset: number }
  | { type: "signature_completed" }
  | { type: "request_completed" }
  | { type: "renewal_upcoming"; daysBefore: number; tzOffset: number };
type Action =
  | { type: "extract"; preset: string }
  | { type: "summarize" }
  | { type: "tag"; tag: string }
  | { type: "notify"; audience: "workspace" | "me" }
  | { type: "email"; to: string }
  | { type: "webhook"; url: string }
  | { type: "assign"; userId: string };
type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  actions: Action[];
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastRun: { status: string; log: string; at: number } | null;
};

const PRESET_LABEL: Record<string, string> = { key_terms: "key terms", dates: "dates & deadlines", risks: "risk flags", obligations: "obligations", parties: "parties", financials: "financials", tables: "tables" };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function triggerLabel(t: Trigger): [string, string] {
  switch (t.type) {
    case "document_uploaded":
      return ["📥 New PDF in library", t.nameContains ? `name contains “${t.nameContains}”` : "Instant, on upload"];
    case "schedule": {
      const days = t.days.length === 7 ? "Every day" : t.days.join() === "1,2,3,4,5" ? "Every weekday" : t.days.map((d) => DAY[d]).join(", ");
      return ["🗓️ Schedule", `${days}, ${t.time}`];
    }
    case "signature_completed":
      return ["✍️ Contract fully signed", "Instant"];
    case "request_completed":
      return ["📨 Requested doc received", "Instant"];
    case "renewal_upcoming":
      return [`📅 Renewal in ${t.daysBefore} days`, "Daily check, 9:00 AM"];
  }
}

function actionLabel(a: Action, members: Member[]): string {
  switch (a.type) {
    case "extract":
      return `🔍 Extract ${PRESET_LABEL[a.preset] ?? a.preset}`;
    case "summarize":
      return "✨ AI summary";
    case "tag":
      return `🏷️ Tag #${a.tag}`;
    case "notify":
      return a.audience === "workspace" ? "🔔 Notify team" : "🔔 Notify me";
    case "email":
      return `✉️ Email ${a.to.split(/[,;\s]+/)[0]}${a.to.includes(",") ? " +" : ""}`;
    case "webhook":
      return `🔗 Webhook ${(() => { try { return new URL(a.url).hostname; } catch { return ""; } })()}`;
    case "assign":
      return `👤 Assign to ${members.find((m) => m.id === a.userId)?.name ?? "member"}`;
  }
}

export function AutomatePanel() {
  const { wid, info, requirePro, active } = useWB();
  const toast = useToast();
  const [list, setList] = useState<Automation[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Partial<Automation> | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ automations: Automation[] }>(`/api/workspaces/${wid}/automations`);
    setList(r.automations);
  }, [wid]);

  useEffect(() => {
    void load().catch(() => setList([]));
    api<{ members: Member[] }>(`/api/workspaces/${wid}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [load, wid]);

  const tz = new Date().getTimezoneOffset();
  const templates: { name: string; trigger: Trigger; actions: Action[]; desc: string }[] = [
    { name: "Risk review on upload", desc: "Flag risky clauses the moment a contract lands", trigger: { type: "document_uploaded" }, actions: [{ type: "extract", preset: "risks" }, { type: "notify", audience: "workspace" }] },
    { name: "Morning digest", desc: "New documents, open requests and pending signatures", trigger: { type: "schedule", time: "08:00", days: [1, 2, 3, 4, 5], tzOffset: tz }, actions: [{ type: "email", to: info.me.email }] },
    { name: "Renewal reminders", desc: "Never miss a notice window again", trigger: { type: "renewal_upcoming", daysBefore: 60, tzOffset: tz }, actions: [{ type: "notify", audience: "workspace" }, { type: "email", to: info.me.email }] },
    { name: "Signed → tracker", desc: "Capture key terms when a contract is executed", trigger: { type: "signature_completed" }, actions: [{ type: "extract", preset: "key_terms" }, { type: "tag", tag: "executed" }, { type: "notify", audience: "workspace" }] },
  ];

  const toggle = async (a: Automation) => {
    try {
      await api(`/api/automations/${a.id}`, { method: "PATCH", json: { enabled: !a.enabled } });
      setList((l) => l?.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)) ?? null);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const runNow = async (a: Automation) => {
    if (!requirePro("Automations")) return;
    setRunning(a.id);
    try {
      const needsDoc = ["document_uploaded", "signature_completed", "request_completed"].includes(a.trigger.type);
      if (needsDoc && !active) throw new Error("Open a document to test this automation against it.");
      const r = await api<{ automation: Automation }>(`/api/automations/${a.id}`, { method: "POST", json: { documentId: needsDoc ? active?.id : undefined } });
      setList((l) => l?.map((x) => (x.id === a.id ? r.automation : x)) ?? null);
      toast(r.automation.lastRun?.status === "success" ? "Automation ran successfully" : "Automation finished with warnings — see the log", r.automation.lastRun?.status === "success" ? "success" : "info");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="panel-body">
      <div className="row between">
        <span className="eyebrow">Automations</span>
        <button className="btn btn-sm btn-primary" onClick={() => requirePro("Automations") && setEditing({ name: "", trigger: { type: "document_uploaded" }, actions: [] })}>
          <I.plus size={12} /> New
        </button>
      </div>
      {list === null && <span className="spinner" />}
      {list?.map((a) => {
        const [tl, tsub] = triggerLabel(a.trigger);
        return (
          <div key={a.id} className="flow" style={{ opacity: a.enabled ? 1 : 0.6 }}>
            <div className="row between">
              <b style={{ fontSize: 13 }}>{a.name}</b>
              <button className={`switch ${a.enabled ? "on" : ""}`} onClick={() => toggle(a)} aria-label={a.enabled ? "Disable" : "Enable"} />
            </div>
            <div className="flow-steps mt-8">
              <span className="flow-step">{tl}</span>
              {a.actions.map((x, i) => (
                <span key={i} className="row gap-4">
                  <span className="flow-arrow">→</span>
                  <span className="flow-step">{actionLabel(x, members)}</span>
                </span>
              ))}
            </div>
            <div className="tiny mono faint mt-8">
              {tsub}
              {a.nextRunAt ? ` · next ${new Date(a.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
              {a.lastRun ? ` · last ran ${timeAgo(a.lastRun.at)} (${a.lastRun.status})` : ""}
            </div>
            {a.lastRun?.log && (
              <details className="mt-8">
                <summary className="tiny faint" style={{ cursor: "pointer" }}>Run log</summary>
                <pre className="tiny mono muted" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{a.lastRun.log}</pre>
              </details>
            )}
            <div className="row gap-4 mt-8">
              <button className="btn btn-sm btn-ghost" onClick={() => runNow(a)} disabled={running === a.id}>
                {running === a.id ? <span className="spinner" /> : <I.play size={11} />} Run now
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>
                Edit
              </button>
              <span className="grow" />
              <button
                className="icon-btn"
                aria-label="Delete automation"
                onClick={async () => {
                  if (!confirm(`Delete “${a.name}”?`)) return;
                  await api(`/api/automations/${a.id}`, { method: "DELETE" });
                  setList((l) => l?.filter((x) => x.id !== a.id) ?? null);
                }}
              >
                <I.trash size={13} />
              </button>
            </div>
          </div>
        );
      })}
      {list && list.length === 0 && (
        <>
          <div className="small muted">Put routine document work on autopilot. Start from a template:</div>
          {templates.map((t) => (
            <button key={t.name} className="flow" style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => requirePro("Automations") && setEditing({ name: t.name, trigger: t.trigger, actions: t.actions })}>
              <b style={{ fontSize: 13 }}>{t.name}</b>
              <div className="small muted">{t.desc}</div>
              <div className="flow-steps mt-8">
                <span className="flow-step">{triggerLabel(t.trigger)[0]}</span>
                {t.actions.map((x, i) => (
                  <span key={i} className="row gap-4">
                    <span className="flow-arrow">→</span>
                    <span className="flow-step">{actionLabel(x, members)}</span>
                  </span>
                ))}
              </div>
            </button>
          ))}
        </>
      )}
      {!info.capabilities.email && list && list.length > 0 && <div className="tiny faint">Email isn’t configured on this server; email actions are logged instead of sent.</div>}
      {editing && (
        <Builder
          initial={editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setList((l) => (l?.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...(l ?? []), a]));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Builder({ initial, members, onClose, onSaved }: { initial: Partial<Automation>; members: Member[]; onClose: () => void; onSaved: (a: Automation) => void }) {
  const { wid, info } = useWB();
  const toast = useToast();
  const tz = new Date().getTimezoneOffset();
  const [name, setName] = useState(initial.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger ?? { type: "document_uploaded" });
  const [actions, setActions] = useState<Action[]>(initial.actions ?? []);
  const [busy, setBusy] = useState(false);

  const setTriggerType = (type: Trigger["type"]) => {
    if (type === "schedule") setTrigger({ type, time: "08:00", days: [1, 2, 3, 4, 5], tzOffset: tz });
    else if (type === "renewal_upcoming") setTrigger({ type, daysBefore: 60, tzOffset: tz });
    else if (type === "document_uploaded") setTrigger({ type, nameContains: "" });
    else setTrigger({ type });
  };

  const addAction = (type: Action["type"]) => {
    const def: Record<Action["type"], Action> = {
      extract: { type: "extract", preset: "risks" },
      summarize: { type: "summarize" },
      tag: { type: "tag", tag: "" },
      notify: { type: "notify", audience: "workspace" },
      email: { type: "email", to: info.me.email },
      webhook: { type: "webhook", url: "" },
      assign: { type: "assign", userId: members[0]?.id ?? info.me.id },
    };
    setActions([...actions, def[type]]);
  };
  const patchAction = (i: number, a: Action) => setActions(actions.map((x, j) => (j === i ? a : x)));

  const save = async () => {
    setBusy(true);
    try {
      const payload = { name, trigger, actions };
      const r = initial.id
        ? await api<{ automation: Automation }>(`/api/automations/${initial.id}`, { method: "PATCH", json: payload })
        : await api<{ automation: Automation }>(`/api/workspaces/${wid}/automations`, { method: "POST", json: payload });
      toast("Automation saved", "success");
      onSaved(r.automation);
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  const docTrigger = ["document_uploaded", "signature_completed", "request_completed", "renewal_upcoming"].includes(trigger.type);

  return (
    <Modal
      title={initial.id ? "Edit automation" : "New automation"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim() || !actions.length} onClick={save}>
            Save automation
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="field">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Risk review on upload" />
        </div>
        <div className="card">
          <div className="eyebrow">When</div>
          <select className="select mt-8" value={trigger.type} onChange={(e) => setTriggerType(e.target.value as Trigger["type"])}>
            <option value="document_uploaded">A document is uploaded</option>
            <option value="schedule">On a schedule (digest)</option>
            <option value="renewal_upcoming">A renewal / expiry date is coming up</option>
            <option value="signature_completed">A signature request is completed</option>
            <option value="request_completed">A requested document is received</option>
          </select>
          {trigger.type === "document_uploaded" && (
            <input className="input mt-8" placeholder="Only when the file name contains… (optional)" value={trigger.nameContains ?? ""} onChange={(e) => setTrigger({ ...trigger, nameContains: e.target.value })} />
          )}
          {trigger.type === "schedule" && (
            <div className="row wrap gap-8 mt-8">
              <input className="input" type="time" style={{ width: 130 }} value={trigger.time} onChange={(e) => setTrigger({ ...trigger, time: e.target.value })} />
              {DAY.map((d, i) => (
                <button key={d} className={`chip ${trigger.days.includes(i) ? "active" : ""}`} onClick={() => setTrigger({ ...trigger, days: trigger.days.includes(i) ? trigger.days.filter((x) => x !== i) : [...trigger.days, i].sort() })}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {trigger.type === "renewal_upcoming" && (
            <div className="row gap-8 mt-8 small">
              Alert
              <input className="input input-sm" type="number" min={1} max={365} style={{ width: 80 }} value={trigger.daysBefore} onChange={(e) => setTrigger({ ...trigger, daysBefore: Number(e.target.value) || 30 })} />
              days before any renewal, expiry or notice date found by “Dates & deadlines” extraction.
            </div>
          )}
        </div>
        <div className="card">
          <div className="eyebrow">Then</div>
          <div className="col mt-8">
            {actions.map((a, i) => (
              <div key={i} className="row gap-8 wrap" style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                <span className="mono tiny faint">{i + 1}</span>
                {a.type === "extract" && (
                  <>
                    <span className="small">Extract</span>
                    <select className="select input-sm" style={{ width: "auto" }} value={a.preset} onChange={(e) => patchAction(i, { ...a, preset: e.target.value })}>
                      {Object.entries(PRESET_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </>
                )}
                {a.type === "summarize" && <span className="small">Write an AI summary of the document</span>}
                {a.type === "tag" && (
                  <>
                    <span className="small">Add tag</span>
                    <input className="input input-sm" style={{ width: 160 }} value={a.tag} onChange={(e) => patchAction(i, { ...a, tag: e.target.value })} placeholder="e.g. review" />
                  </>
                )}
                {a.type === "notify" && (
                  <>
                    <span className="small">Notify</span>
                    <select className="select input-sm" style={{ width: "auto" }} value={a.audience} onChange={(e) => patchAction(i, { ...a, audience: e.target.value as "workspace" | "me" })}>
                      <option value="workspace">everyone in the workspace</option>
                      <option value="me">me</option>
                    </select>
                  </>
                )}
                {a.type === "email" && (
                  <>
                    <span className="small">Email</span>
                    <input className="input input-sm grow" value={a.to} onChange={(e) => patchAction(i, { ...a, to: e.target.value })} placeholder="comma-separated addresses" />
                  </>
                )}
                {a.type === "webhook" && (
                  <>
                    <span className="small">POST to</span>
                    <input className="input input-sm grow" value={a.url} onChange={(e) => patchAction(i, { ...a, url: e.target.value })} placeholder="https://hooks.slack.com/…" />
                  </>
                )}
                {a.type === "assign" && (
                  <>
                    <span className="small">Assign to</span>
                    <select className="select input-sm" style={{ width: "auto" }} value={a.userId} onChange={(e) => patchAction(i, { ...a, userId: e.target.value })}>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </>
                )}
                <span className="grow" />
                <button className="icon-btn" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Remove action">
                  <I.x size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="row wrap gap-4 mt-12">
            {docTrigger && (
              <>
                <button className="chip" onClick={() => addAction("extract")}>+ Extract</button>
                <button className="chip" onClick={() => addAction("summarize")}>+ Summarize</button>
                <button className="chip" onClick={() => addAction("tag")}>+ Tag</button>
                <button className="chip" onClick={() => addAction("assign")}>+ Assign</button>
              </>
            )}
            <button className="chip" onClick={() => addAction("notify")}>+ Notify</button>
            <button className="chip" onClick={() => addAction("email")}>+ Email</button>
            <button className="chip" onClick={() => addAction("webhook")}>+ Webhook (Slack, Teams, Zapier)</button>
          </div>
          <div className="tiny faint mt-8">Notifications, emails and webhooks include the results of earlier steps (e.g. extracted risk flags).</div>
        </div>
      </div>
    </Modal>
  );
}
