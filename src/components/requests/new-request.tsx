"use client";
import { useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { ACCEPT_LABEL, REQUEST_TEMPLATES, type Accept } from "@/lib/request-templates";
import { I } from "../icons";
import { Modal } from "../modal";
import { useToast } from "../toast";

type Row = { label: string; note: string; required: boolean; accept: Accept };
type Verify = "email" | "code" | "none";
type Created = { id: string; link: string; delivered: boolean; accessCode: string | null };

const blank = (): Row => ({ label: "", note: "", required: true, accept: "any" });

/** Ask someone for documents: a checklist, security options, reminders. */
export function NewRequestModal({ wid, emailEnabled, onClose, onCreated }: { wid: string; emailEnabled: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [template, setTemplate] = useState("custom");
  const [form, setForm] = useState({ title: "", recipientName: "", recipientEmail: "", dueDate: "", message: "" });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [verify, setVerify] = useState<Verify>(emailEnabled ? "email" : "code");
  const [expires, setExpires] = useState(30);
  const [autoRemind, setAutoRemind] = useState(emailEnabled);
  const [packet, setPacket] = useState(true);
  const [result, setResult] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const pick = (key: string) => {
    setTemplate(key);
    const t = REQUEST_TEMPLATES.find((x) => x.key === key);
    if (!t) {
      setRows([blank()]);
      return;
    }
    setForm({ ...form, title: t.title, message: t.message });
    setRows(t.items.map((it) => ({ label: it.label, note: it.note ?? "", required: it.required !== false, accept: it.accept ?? "any" })));
  };

  const filled = rows.filter((r) => r.label.trim());
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<Created>(`/api/workspaces/${wid}/requests`, {
        method: "POST",
        json: {
          ...form,
          dueDate: form.dueDate || null,
          items: filled.map((r) => ({ ...r, label: r.label.trim(), note: r.note.trim() || undefined })),
          verify,
          expiresInDays: expires,
          autoRemind,
          packet,
        },
      });
      setResult(r);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast("Copied"));
    return (
      <Modal title="Request sent" onClose={() => onCreated(result.id)} footer={<button className="btn btn-primary" onClick={() => onCreated(result.id)}>Done</button>}>
        <p className="small muted" style={{ marginTop: 0 }}>
          {result.delivered ? `We emailed ${form.recipientName} a secure upload link.` : "Email isn't set up on this server, so share this secure upload link yourself:"}
        </p>
        <div className="row">
          <input className="input input-sm grow mono" readOnly value={result.link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-sm" onClick={() => copy(result.link)}>
            <I.copy size={12} /> Copy
          </button>
        </div>
        {result.accessCode && (
          <div className="card card-tight mt-16">
            <div className="small">
              <b>Access code</b> · give this to {form.recipientName} by phone or text, not in the same email as the link.
            </div>
            <div className="row mt-8">
              <span className="rq-code-show grow">{result.accessCode}</span>
              <button className="btn btn-sm" onClick={() => copy(result.accessCode!)}>
                <I.copy size={12} /> Copy
              </button>
            </div>
            <div className="tiny faint mt-8">For your security it&apos;s shown only now. You can make a new one from the request later.</div>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="Request documents"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !form.title || !form.recipientName || !form.recipientEmail || !filled.length} onClick={submit}>
            {busy && <span className="spinner" />} <I.mail size={13} /> Send request
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            Start from a template
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {[{ key: "custom", name: "Custom" }, ...REQUEST_TEMPLATES].map((t) => (
              <button key={t.key} className={`chip rq-chip ${template === t.key ? "active" : ""}`} onClick={() => pick(t.key)}>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Request title</label>
          <input className="input" value={form.title} onChange={set("title")} placeholder="e.g. Tax documents 2025, Onboarding paperwork" />
        </div>
        <div className="row gap-12 wrap">
          <div className="field grow">
            <label>Recipient name</label>
            <input className="input" value={form.recipientName} onChange={set("recipientName")} />
          </div>
          <div className="field grow">
            <label>Recipient email</label>
            <input className="input" type="email" value={form.recipientEmail} onChange={set("recipientEmail")} />
          </div>
        </div>

        <div>
          <div className="row between">
            <label className="small" style={{ fontWeight: 600 }}>
              Checklist
            </label>
            <span className="tiny faint">Each item gets its own upload. Several files for one item are combined into one PDF.</span>
          </div>
          <div className="col gap-8 mt-8">
            {rows.map((r, i) => (
              <div key={i} className="rq-row">
                <span className="tiny faint mono rq-num">{i + 1}</span>
                <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
                  <input className="input input-sm" value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Document needed, e.g. Photo ID" aria-label="Document needed" />
                  <input className="input input-sm" value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} placeholder="Instructions (optional)" aria-label="Instructions" />
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <select className="select input-sm" value={r.accept} onChange={(e) => setRow(i, { accept: e.target.value as Accept })} aria-label="File type">
                    {(Object.keys(ACCEPT_LABEL) as Accept[]).map((a) => (
                      <option key={a} value={a}>
                        {ACCEPT_LABEL[a]}
                      </option>
                    ))}
                  </select>
                  <label className="row tiny" style={{ gap: 6 }}>
                    <input type="checkbox" checked={r.required} onChange={(e) => setRow(i, { required: e.target.checked })} /> Required
                  </label>
                </div>
                <button className="icon-btn" aria-label="Remove item" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <I.x size={12} />
                </button>
              </div>
            ))}
          </div>
          {rows.length < 25 && (
            <button className="btn btn-sm btn-ghost mt-8" onClick={() => setRows([...rows, blank()])}>
              <I.plus size={12} /> Add item
            </button>
          )}
        </div>

        <div className="field">
          <label>Message (optional)</label>
          <textarea className="textarea" value={form.message} onChange={set("message")} placeholder="Any instructions for the recipient" />
        </div>

        <fieldset className="rq-security-opts">
          <legend className="small" style={{ fontWeight: 600 }}>
            <I.shield size={13} /> Security
          </legend>
          {(
            [
              ["email", "Email code (recommended)", "The recipient enters a one-time code we email to them. Only someone with access to their inbox can upload.", !emailEnabled],
              ["code", "Access code", "You share an 8-character code by phone or text. Even a forwarded email isn't enough to open it.", false],
              ["none", "Link only", "Anyone with the link can upload. Simplest, least secure.", false],
            ] as [Verify, string, string, boolean][]
          ).map(([v, title, desc, disabled]) => (
            <label key={v} className={`rq-opt ${verify === v ? "on" : ""} ${disabled ? "disabled" : ""}`}>
              <input type="radio" name="verify" checked={verify === v} disabled={disabled} onChange={() => setVerify(v)} />
              <span>
                <b className="small">{title}</b>
                <span className="tiny muted" style={{ display: "block" }}>
                  {disabled ? "Needs email sending to be set up on the server." : desc}
                </span>
              </span>
            </label>
          ))}
          <div className="row gap-12 wrap mt-8">
            <div className="field">
              <label>Due date (optional)</label>
              <input className="input input-sm" type="date" value={form.dueDate} onChange={set("dueDate")} />
            </div>
            <div className="field">
              <label>Link expires after</label>
              <select className="select input-sm" value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
                {[7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="row small mt-8" style={{ gap: 8 }}>
            <input type="checkbox" checked={autoRemind} disabled={!emailEnabled} onChange={(e) => setAutoRemind(e.target.checked)} />
            Send reminders automatically until it&apos;s done (up to 3)
          </label>
          <label className="row small mt-8" style={{ gap: 8 }}>
            <input type="checkbox" checked={packet} onChange={(e) => setPacket(e.target.checked)} />
            Also combine everything into one PDF packet when it&apos;s complete
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}
