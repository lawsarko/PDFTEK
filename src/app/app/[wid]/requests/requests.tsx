"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import type { WorkspaceInfo } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { NewRequestModal } from "@/components/requests/new-request";
import { notifyPaywall } from "@/components/paywall";
import { useToast } from "@/components/toast";

type Summary = {
  id: string;
  title: string;
  message: string;
  recipientName: string;
  recipientEmail: string;
  dueDate: string | null;
  status: "pending" | "viewed" | "in_progress" | "complete" | "cancelled" | "expired";
  documentId: string | null;
  packetDocumentId: string | null;
  createdAt: number;
  viewedAt: number | null;
  completedAt: number | null;
  expiresAt: number | null;
  verify: "none" | "email" | "code";
  autoRemind: boolean;
  packet: boolean;
  received: number;
  total: number;
  link: string;
};
type Item = { id: string; label: string; note: string; required: boolean; acceptLabel: string; status: "needed" | "uploaded" | "returned"; files: string[]; feedback: string | null; uploadedAt: number | null; documentId: string | null };
type Detail = Summary & { items: Item[]; events: { kind: string; detail: string; ip: string | null; createdAt: number }[] };

const STATUS: Record<Summary["status"], [string, string]> = {
  pending: ["Sent", "badge-muted"],
  viewed: ["Opened", "badge-info"],
  in_progress: ["In progress", "badge-warn"],
  complete: ["Complete", "badge-good"],
  cancelled: ["Cancelled", "badge-muted"],
  expired: ["Expired", "badge-bad"],
};

const EVENT: Record<string, string> = {
  created: "Request created",
  emailed: "Emailed to recipient",
  code_sent: "Verification code emailed",
  verified: "Recipient verified",
  verify_failed: "Wrong code entered",
  locked: "Locked after too many wrong codes",
  uploaded: "Uploaded",
  submitted: "Submitted",
  returned: "Sent back for a new copy",
  reminded: "Reminder",
  extended: "Link extended",
  code_changed: "Access code changed",
  cancelled: "Cancelled",
};

const SECURITY: Record<Summary["verify"], string> = { email: "Email code", code: "Access code", none: "Link only" };
const fmt = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const open = (s: Summary["status"]) => s === "pending" || s === "viewed" || s === "in_progress";

export function Requests({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [list, setList] = useState<Summary[] | null>(null);
  const [filter, setFilter] = useState<"open" | "complete" | "all">("open");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [returning, setReturning] = useState<Item | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const selected = params.get("id");

  const load = useCallback(async () => {
    const r = await api<{ requests: Summary[] }>(`/api/workspaces/${wid}/requests`);
    setList(r.requests);
  }, [wid]);
  const loadDetail = useCallback(async (id: string) => {
    const r = await api<{ request: Detail }>(`/api/requests/${id}`);
    setDetail(r.request);
  }, []);

  useEffect(() => {
    api<WorkspaceInfo>(`/api/workspaces/${wid}`).then(setInfo).catch(() => {});
    void load().catch((e) => toast(errMsg(e), "error"));
  }, [wid, load, toast]);
  useEffect(() => {
    if (selected) void loadDetail(selected).catch((e) => toast(errMsg(e), "error"));
    else setDetail(null);
  }, [selected, loadDetail, toast]);

  // Opened from Tools → Request documents: free plans see the upgrade options instead of the form.
  useEffect(() => {
    if (creating && info && !info.billing.membership) {
      setCreating(false);
      notifyPaywall({ code: "membership_required", message: "Document requests need a Day Pass, Pro or Team." });
    }
  }, [creating, info]);

  const select = (id: string | null) => router.replace(`/app/${wid}/requests${id ? `?id=${id}` : ""}`, { scroll: false });
  const startNew = () => {
    if (info && !info.billing.membership) return notifyPaywall({ code: "membership_required", message: "Document requests need a Day Pass, Pro or Team." });
    setCreating(true);
  };

  const act = async (action: Record<string, unknown>, done?: string) => {
    if (!detail) return;
    try {
      const r = await api<{ delivered?: boolean; accessCode?: string }>(`/api/requests/${detail.id}`, { method: "POST", json: action });
      if (action.action === "delete") {
        select(null);
      } else {
        await loadDetail(detail.id);
      }
      if (r.accessCode) setNewCode(r.accessCode);
      if (done) toast(r.delivered === false ? `${done} (email isn't set up, so share the link yourself)` : done, r.delivered === false ? "info" : "success");
      void load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const shown = (list ?? []).filter((r) => (filter === "all" ? true : filter === "open" ? open(r.status) : !open(r.status)));
  const counts = { open: (list ?? []).filter((r) => open(r.status)).length, complete: (list ?? []).filter((r) => !open(r.status)).length, all: list?.length ?? 0 };

  return (
    <AppShell
      wid={wid}
      title="Document requests"
      actions={
        <button className="btn btn-primary btn-sm" onClick={startNew}>
          <I.plus size={13} /> New request
        </button>
      }
    >
      <div className="shell rq-page">
        <aside className="rq-list">
          <div className="fx-tabs" role="tablist">
            {(["open", "complete", "all"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={`fx-tab ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "complete" ? "Closed" : "All"} <span className="faint">{counts[f]}</span>
              </button>
            ))}
          </div>
          {list === null && <span className="spinner mt-16" />}
          {list?.length === 0 && (
            <div className="rq-empty">
              <I.inbox size={26} />
              <b>Collect documents securely</b>
              <p className="small muted">
                Send a checklist of the files you need. People upload through a private link, verified by a one-time code, with no account needed. You&apos;ll see who opened it,
                what arrived and when.
              </p>
              <button className="btn btn-primary" onClick={startNew}>
                <I.plus size={13} /> New request
              </button>
            </div>
          )}
          {shown.map((r) => (
            <button key={r.id} className={`rq-li ${selected === r.id ? "on" : ""}`} onClick={() => select(r.id)}>
              <div className="row between" style={{ gap: 8 }}>
                <b className="small ellipsis">{r.title}</b>
                <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              </div>
              <div className="tiny muted ellipsis">{r.recipientName}</div>
              <div className="rq-bar">
                <span style={{ width: `${r.total ? (r.received / r.total) * 100 : 0}%` }} />
              </div>
              <div className="tiny faint mono">
                {r.received}/{r.total} received · {r.dueDate ? `due ${r.dueDate}` : `sent ${timeAgo(r.createdAt)}`}
              </div>
            </button>
          ))}
        </aside>

        <section className="rq-detail">
          {!detail ? (
            <div className="rq-empty">
              <I.shield size={26} />
              <b>Pick a request to see its checklist and audit trail</b>
              <ul className="rq-perks small muted">
                <li>Templates for tax, rental, ID verification, loans and onboarding</li>
                <li>One-time email codes or access codes, plus links that expire</li>
                <li>Automatic reminders, and send back any file with a note</li>
                <li>Uploads arrive as PDFs, optionally combined into one packet</li>
              </ul>
            </div>
          ) : (
            <>
              <div className="row between wrap" style={{ gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontSize: 20, margin: 0 }}>{detail.title}</h2>
                  <div className="small muted">
                    {detail.recipientName} · {detail.recipientEmail}
                  </div>
                </div>
                <span className={`badge ${STATUS[detail.status][1]}`}>{STATUS[detail.status][0]}</span>
              </div>

              <div className="rq-facts">
                <span>
                  <I.shield size={12} /> {SECURITY[detail.verify]}
                </span>
                {detail.dueDate && (
                  <span>
                    <I.clock size={12} /> Due {detail.dueDate}
                  </span>
                )}
                {detail.expiresAt && (
                  <span>
                    <I.lock size={12} /> {detail.status === "expired" ? "Expired" : "Link open until"} {new Date(detail.expiresAt).toLocaleDateString()}
                  </span>
                )}
                {detail.autoRemind && (
                  <span>
                    <I.bell size={12} /> Auto reminders
                  </span>
                )}
              </div>

              <div className="row wrap" style={{ gap: 6 }}>
                {open(detail.status) && (
                  <>
                    <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(detail.link).then(() => toast("Link copied"))}>
                      <I.link size={12} /> Copy link
                    </button>
                    <button className="btn btn-sm" onClick={() => act({ action: "remind" }, `Reminder sent to ${detail.recipientName}`)}>
                      <I.mail size={12} /> Remind
                    </button>
                    {detail.verify === "code" && (
                      <button className="btn btn-sm" onClick={() => act({ action: "new_code" })}>
                        <I.lock size={12} /> New access code
                      </button>
                    )}
                  </>
                )}
                {detail.status !== "complete" && (
                  <button className="btn btn-sm" onClick={() => act({ action: "extend", days: 14 }, "Link extended by 14 days")}>
                    <I.clock size={12} /> Extend 14 days
                  </button>
                )}
                {detail.packetDocumentId && (
                  <Link className="btn btn-sm btn-primary" href={`/app/${wid}?doc=${detail.packetDocumentId}`}>
                    <I.file size={12} /> Open combined packet
                  </Link>
                )}
                {open(detail.status) && (
                  <button className="btn btn-sm btn-ghost" onClick={() => confirm("Cancel this request? The link will stop working.") && act({ action: "cancel" }, "Request cancelled")}>
                    Cancel request
                  </button>
                )}
                {!open(detail.status) && (
                  <button className="btn btn-sm btn-ghost" onClick={() => confirm("Delete this request and its audit trail? Uploaded files stay in your library.") && act({ action: "delete" }, "Request deleted")}>
                    <I.trash size={12} /> Delete
                  </button>
                )}
              </div>

              <h3 className="rq-h">
                Checklist <span className="faint">{detail.received} of {detail.total} received</span>
              </h3>
              <div className="col gap-8">
                {detail.items.map((it) => (
                  <div key={it.id} className={`rq-item ${it.status === "uploaded" ? "done" : ""} ${it.status === "returned" ? "returned" : ""}`}>
                    <span className="rq-check">{it.status === "uploaded" ? <I.check size={14} /> : <I.file size={14} />}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <b className="small">{it.label}</b>
                        {!it.required && <span className="badge badge-muted">Optional</span>}
                        <span className="tiny faint">{it.acceptLabel}</span>
                      </div>
                      {it.status === "uploaded" ? (
                        <div className="tiny muted ellipsis">
                          {it.files.join(", ")} · {timeAgo(it.uploadedAt!)}
                        </div>
                      ) : it.status === "returned" ? (
                        <div className="tiny rq-feedback">Sent back: {it.feedback}</div>
                      ) : (
                        <div className="tiny faint">Waiting{it.note ? ` · ${it.note}` : ""}</div>
                      )}
                    </div>
                    {it.documentId && (
                      <Link className="btn btn-sm" href={`/app/${wid}?doc=${it.documentId}`}>
                        Open
                      </Link>
                    )}
                    {it.status === "uploaded" && detail.status !== "cancelled" && detail.status !== "expired" && (
                      <button className="btn btn-sm btn-ghost" title="Ask for a new copy" onClick={() => setReturning(it)}>
                        <I.undo size={12} /> Send back
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <h3 className="rq-h">Audit trail</h3>
              <ol className="rq-events">
                {detail.events.map((e, i) => (
                  <li key={i} className={`ev-${e.kind}`}>
                    <span className="tiny faint mono">{fmt(e.createdAt)}</span>
                    <span className="small">
                      <b>{EVENT[e.kind] ?? e.kind}</b>
                      {e.detail && <span className="muted"> · {e.detail}</span>}
                    </span>
                    {e.ip && <span className="tiny faint mono">IP {e.ip}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>

      {creating && info && (
        <NewRequestModal
          wid={wid}
          emailEnabled={info.capabilities.email}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void load();
            select(id);
          }}
        />
      )}
      {returning && detail && (
        <ReturnModal
          item={returning}
          name={detail.recipientName}
          onClose={() => setReturning(null)}
          onSend={async (feedback) => {
            await act({ action: "return", itemId: returning.id, feedback }, `Asked ${detail.recipientName} for a new copy`);
            setReturning(null);
          }}
        />
      )}
      {newCode && (
        <Modal title="New access code" onClose={() => setNewCode(null)} footer={<button className="btn btn-primary" onClick={() => setNewCode(null)}>Done</button>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            The old code no longer works, and anyone already signed in to the link was signed out. Give this code to {detail?.recipientName} by phone or text.
          </p>
          <div className="row">
            <span className="rq-code-show grow">{newCode}</span>
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(newCode).then(() => toast("Copied"))}>
              <I.copy size={12} /> Copy
            </button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function ReturnModal({ item, name, onClose, onSend }: { item: Item; name: string; onClose: () => void; onSend: (feedback: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Send back: ${item.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!text.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await onSend(text.trim());
              setBusy(false);
            }}
          >
            {busy && <span className="spinner" />} Ask for a new copy
          </button>
        </>
      }
    >
      <div className="field">
        <label>What&apos;s wrong? {name} will see this.</label>
        <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. This statement is from 2023, please upload the latest one." />
      </div>
      <div className="row wrap mt-8" style={{ gap: 6 }}>
        {["It's blurry or hard to read", "A page is missing", "It's out of date", "Wrong document"].map((s) => (
          <button key={s} className="chip rq-chip" onClick={() => setText(s)}>
            {s}
          </button>
        ))}
      </div>
    </Modal>
  );
}
