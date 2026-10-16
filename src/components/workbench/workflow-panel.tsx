"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, initials, timeAgo } from "@/lib/client/api";
import type { Activity, Doc, Member } from "@/lib/client/types";
import { I } from "../icons";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";

type DocRequest = {
  id: string;
  title: string;
  recipientName: string;
  recipientEmail: string;
  dueDate: string | null;
  status: "pending" | "viewed" | "complete" | "cancelled";
  documentId: string | null;
  createdAt: number;
  completedAt: number | null;
  link: string;
};
type Envelope = {
  id: string;
  title: string;
  status: string;
  documentId: string;
  signedVersionId: string | null;
  createdAt: number;
  signers: { id: string; name: string; email: string; status: string; signedAt: number | null; link: string; declineReason: string | null }[];
};

const STATUS_BADGE: Record<string, string> = { pending: "badge-muted", viewed: "badge-info", complete: "badge-good", completed: "badge-good", signed: "badge-good", sent: "badge-warn", declined: "badge-bad", cancelled: "badge-muted" };

const ACTION_TEXT: Record<string, string> = {
  uploaded: "uploaded",
  saved_version: "saved a new version of",
  checked_out: "checked out",
  checked_in: "checked in",
  handed_off: "handed off",
  renamed: "renamed",
  deleted: "deleted",
  restored: "restored",
  extracted: "extracted data from",
  converted: "converted",
  merged: "merged documents into",
  ocr: "ran OCR on",
  sent_for_signature: "sent for signature",
  signed: "signed",
  declined_signature: "declined to sign",
  signature_completed: "completed signatures on",
  cancelled_signature: "cancelled signatures on",
  requested_document: "requested a document",
  fulfilled_request: "fulfilled a request with",
  automation_ran: "ran on",
  joined: "joined the workspace",
  created_workspace: "created the workspace",
  started_trial: "started a Pro trial",
  removed_member: "removed a member",
  left: "left the workspace",
};

export function WorkflowPanel() {
  const { wid, active, info, openDoc, upsertDoc, requirePro } = useWB();
  const toast = useToast();
  const [requests, setRequests] = useState<DocRequest[] | null>(null);
  const [envelopes, setEnvelopes] = useState<Envelope[] | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [newReq, setNewReq] = useState(false);

  const load = useCallback(async () => {
    const [r, a, m] = await Promise.all([
      api<{ requests: DocRequest[] }>(`/api/workspaces/${wid}/requests`),
      api<{ activity: Activity[] }>(`/api/workspaces/${wid}/activity`),
      api<{ members: Member[] }>(`/api/workspaces/${wid}/members`),
    ]);
    setRequests(r.requests);
    setActivity(a.activity);
    setMembers(m.members);
    if (active) setEnvelopes((await api<{ requests: Envelope[] }>(`/api/workspaces/${wid}/signatures?doc=${active.id}`)).requests);
  }, [wid, active]);

  useEffect(() => {
    void load().catch((e) => toast(errMsg(e), "error"));
  }, [load, toast]);

  const reqAction = async (r: DocRequest, action: "remind" | "cancel" | "delete") => {
    try {
      const res = await api<{ delivered?: boolean }>(`/api/requests/${r.id}`, { method: "POST", json: { action } });
      if (action === "remind") toast(res.delivered ? `Reminder emailed to ${r.recipientName}` : "Reminder logged (email not configured) — share the link directly", res.delivered ? "success" : "info");
      void load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const envAction = async (env: Envelope, action: "remind" | "cancel") => {
    try {
      const res = await api<{ reminded?: number; delivered?: number }>(`/api/signatures/${env.id}`, { method: "POST", json: { action } });
      toast(action === "remind" ? `Reminded ${res.reminded} signer(s)` : "Signature request cancelled", "success");
      void load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const handTo = async (m: Member) => {
    if (!active) return;
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${active.id}/handoff`, { method: "POST", json: { userId: m.id } });
      upsertDoc(r.document);
      toast(`Handed to ${m.name}`, "success");
      void load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast("Link copied"));

  return (
    <div className="panel-body">
      <section>
        <div className="row between">
          <span className="eyebrow">Document requests</span>
          <button className="btn btn-sm" onClick={() => requirePro("Document requests") && setNewReq(true)}>
            <I.plus size={12} /> New request
          </button>
        </div>
        {requests === null && <span className="spinner mt-8" />}
        {requests?.length === 0 && <div className="small muted mt-8">Ask clients or counterparties for documents with a secure upload link — no account needed.</div>}
        {requests?.slice(0, 8).map((r) => (
          <div key={r.id} className="list-item">
            <I.inbox size={15} />
            <div className="grow">
              <div className="small ellipsis" style={{ fontWeight: 500 }}>
                {r.title} — from {r.recipientName}
              </div>
              <div className="tiny faint mono">
                {r.status === "complete" ? `Completed ${timeAgo(r.completedAt!)}` : `${r.dueDate ? `Due ${r.dueDate} · ` : ""}sent ${timeAgo(r.createdAt)}`}
              </div>
              {r.status !== "complete" && r.status !== "cancelled" && (
                <div className="row gap-4 mt-8">
                  <button className="btn btn-sm btn-ghost" onClick={() => copy(r.link)}>
                    <I.link size={11} /> Copy link
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => reqAction(r, "remind")}>
                    Remind
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => reqAction(r, "cancel")}>
                    Cancel
                  </button>
                </div>
              )}
              {r.status === "complete" && r.documentId && (
                <button className="btn btn-sm btn-ghost mt-8" onClick={() => openDoc(r.documentId)}>
                  Open document
                </button>
              )}
            </div>
            <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
          </div>
        ))}
      </section>

      <hr className="divider" />
      <section>
        <div className="row between">
          <span className="eyebrow">Signatures — this document</span>
          {active && (
            <Link className="btn btn-sm" href={`/app/${wid}/send/${active.id}`} onClick={(e) => !requirePro("E-signatures") && e.preventDefault()}>
              <I.plus size={12} /> Request
            </Link>
          )}
        </div>
        {!active && <div className="small muted mt-8">Open a document to see its signature requests.</div>}
        {active && envelopes?.length === 0 && <div className="small muted mt-8">No signature requests yet. Place fields, add signers, and pdftek handles reminders and the audit trail.</div>}
        {envelopes?.map((env) => (
          <div key={env.id} className="card card-tight mt-8">
            <div className="row between">
              <b className="small ellipsis">{env.title}</b>
              <span className={`badge ${STATUS_BADGE[env.status] ?? "badge-muted"}`}>{env.status}</span>
            </div>
            {env.signers.map((s) => (
              <div key={s.id} className="row small mt-8">
                <span className="avatar">{initials(s.name)}</span>
                <span className="grow ellipsis">
                  {s.name}
                  <div className="tiny faint">{s.status === "signed" ? `Signed ${timeAgo(s.signedAt!)}` : s.status === "declined" ? `Declined: ${s.declineReason}` : s.email}</div>
                </span>
                <span className={`badge ${STATUS_BADGE[s.status] ?? "badge-muted"}`}>{s.status}</span>
                {env.status === "sent" && s.status !== "signed" && (
                  <button className="icon-btn" title="Copy signing link" onClick={() => copy(s.link)}>
                    <I.link size={12} />
                  </button>
                )}
              </div>
            ))}
            <div className="row gap-4 mt-8">
              {env.status === "sent" && (
                <>
                  <button className="btn btn-sm btn-ghost" onClick={() => envAction(env, "remind")}>
                    <I.mail size={11} /> Send reminder
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => envAction(env, "cancel")}>
                    Cancel
                  </button>
                </>
              )}
              {env.status === "completed" && env.signedVersionId && (
                <a className="btn btn-sm btn-ghost" href={`/api/documents/${env.documentId}/file?version=${env.signedVersionId}&download=1`}>
                  <I.download size={11} /> Signed copy + certificate
                </a>
              )}
            </div>
          </div>
        ))}
      </section>

      {active && (
        <>
          <hr className="divider" />
          <section>
            <span className="eyebrow">Hand off</span>
            <div className="row small mt-8">
              <span className="avatar">{initials(active.assignedTo?.name ?? "—")}</span>
              <span className="grow">
                <div className="tiny faint">Currently assigned to</div>
                {active.assignedTo ? (active.assignedTo.id === info.me.id ? "You" : active.assignedTo.name) : "Nobody"}
              </span>
            </div>
            {members
              .filter((m) => m.id !== active.assignedTo?.id)
              .slice(0, 6)
              .map((m) => (
                <button key={m.id} className="menu-item" onClick={() => handTo(m)}>
                  <span className="avatar">{initials(m.name)}</span>
                  <span className="grow">
                    {m.name} {m.id === info.me.id && <span className="faint">(you)</span>}
                  </span>
                  <I.swap size={13} />
                </button>
              ))}
            {members.length <= 1 && (
              <div className="small muted">
                <Link href={`/app/${wid}/settings?tab=members`}>Invite teammates</Link> to hand documents off.
              </div>
            )}
          </section>
        </>
      )}

      <hr className="divider" />
      <section>
        <span className="eyebrow">Activity</span>
        {activity?.length === 0 && <div className="small muted mt-8">No activity yet.</div>}
        {activity?.slice(0, 25).map((a) => (
          <div key={a.id} className="list-item small" style={{ alignItems: "flex-start" }}>
            <span className="avatar">{initials(a.actor)}</span>
            <div className="grow">
              <b style={{ fontWeight: 500 }}>{a.actor}</b> {ACTION_TEXT[a.action] ?? a.action.replace(/_/g, " ")}{" "}
              {a.documentId && a.documentName ? (
                <button className="btn-ghost" style={{ background: "none", border: "none", color: "var(--amber)", cursor: "pointer", padding: 0 }} onClick={() => openDoc(a.documentId)}>
                  {a.documentName}
                </button>
              ) : typeof a.meta.title === "string" ? (
                <span className="muted">{a.meta.title}</span>
              ) : null}
              {a.action === "handed_off" && typeof a.meta.to === "string" && <> to {a.meta.to}</>}
              <div className="tiny faint mono">{timeAgo(a.createdAt)}</div>
            </div>
          </div>
        ))}
      </section>

      {newReq && (
        <NewRequestModal
          onClose={() => setNewReq(false)}
          onCreated={() => {
            setNewReq(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { wid } = useWB();
  const toast = useToast();
  const [form, setForm] = useState({ title: "", recipientName: "", recipientEmail: "", dueDate: "", message: "" });
  const [result, setResult] = useState<{ link: string; delivered: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ link: string; delivered: boolean }>(`/api/workspaces/${wid}/requests`, { method: "POST", json: { ...form, dueDate: form.dueDate || null } });
      setResult(r);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title="Request sent" onClose={onCreated} footer={<button className="btn btn-primary" onClick={onCreated}>Done</button>}>
        <p className="small muted" style={{ marginTop: 0 }}>
          {result.delivered ? `We emailed ${form.recipientName} a secure upload link.` : "Email isn't configured on this server, so share this secure upload link directly:"}
        </p>
        <div className="row">
          <input className="input input-sm grow mono" readOnly value={result.link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(result.link).then(() => toast("Copied"))}>
            <I.copy size={12} /> Copy
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Request a document"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !form.title || !form.recipientName || !form.recipientEmail} onClick={submit}>
            Send request
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="field">
          <label>What do you need?</label>
          <input className="input" value={form.title} onChange={set("title")} placeholder="e.g. Signed NDA, W-9, Insurance certificate" />
        </div>
        <div className="row gap-12 wrap">
          <div className="field grow">
            <label>From (name)</label>
            <input className="input" value={form.recipientName} onChange={set("recipientName")} />
          </div>
          <div className="field grow">
            <label>Email</label>
            <input className="input" type="email" value={form.recipientEmail} onChange={set("recipientEmail")} />
          </div>
        </div>
        <div className="field">
          <label>Due date (optional)</label>
          <input className="input" type="date" value={form.dueDate} onChange={set("dueDate")} />
        </div>
        <div className="field">
          <label>Message (optional)</label>
          <textarea className="textarea" value={form.message} onChange={set("message")} placeholder="Any instructions for the recipient" />
        </div>
      </div>
    </Modal>
  );
}
