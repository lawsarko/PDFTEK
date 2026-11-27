"use client";
import { useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { ACCEPT_LABEL, FIRM_TEMPLATES, REQUEST_TEMPLATES, type Accept, type RequestTemplate } from "@/lib/request-templates";

/** Checklists to start from: everyday paperwork for any business, and tax and accounting sets. */
const GENERAL: RequestTemplate[] = REQUEST_TEMPLATES.filter((t) => t.key !== "tax").map((t) => ({ ...t, key: `g_${t.key}` }));
const ALL_TEMPLATES = [...GENERAL, ...FIRM_TEMPLATES];
/** Sets that recur on their own schedule (titles without a year). */
const NO_YEAR = new Set(["bookkeeping", "g_kyc", "g_employee", "g_claim", "g_rental", "g_loan", "g_client"]);
import { seasonYear } from "@/lib/client-shared";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { I } from "../icons";

type Item = { label: string; note: string; required: boolean; accept: Accept };
const blankItem = (): Item => ({ label: "", note: "", required: true, accept: "any" });

/**
 * Ask one or many clients for documents. Starts from a firm checklist, from last year's return
 * (AI reads it and lists this year's documents), or from scratch.
 */
export function RequestBuilder({
  wid,
  target,
  onClose,
  onSent,
}: {
  wid: string;
  /** One client, several, or everyone with a tag. */
  target: { kind: "one"; id: string; name: string } | { kind: "many"; ids: string[] } | { kind: "tag"; tag: string; count: number };
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const year0 = seasonYear();
  const first = GENERAL.find((t) => t.key === "g_client") ?? GENERAL[0];
  const [template, setTemplate] = useState<string>(first.key);
  const [title, setTitle] = useState(first.title);
  const [message, setMessage] = useState(first.message);
  const [items, setItems] = useState<Item[]>(first.items.map((i) => ({ label: i.label, note: i.note ?? "", required: i.required !== false, accept: i.accept ?? "any" })));
  const [year, setYear] = useState(year0);
  const [due, setDue] = useState("");
  const [verify, setVerify] = useState<"none" | "email" | "code">("email");
  const [autoRemind, setAutoRemind] = useState(true);
  const [repeat, setRepeat] = useState<"" | "month" | "quarter" | "year">("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(key: string) {
    setTemplate(key);
    if (key === "blank") {
      setTitle(`${year} documents`);
      setMessage("");
      setItems([blankItem()]);
      return;
    }
    const t = ALL_TEMPLATES.find((x) => x.key === key)!;
    setTitle(NO_YEAR.has(key) ? t.title : `${year} ${t.title.charAt(0).toLowerCase()}${t.title.slice(1)}`);
    setMessage(t.message);
    setItems(t.items.map((i) => ({ label: i.label, note: i.note ?? "", required: i.required !== false, accept: i.accept ?? "any" })));
    if (key === "bookkeeping" && target.kind === "one") setRepeat("month");
  }

  async function fromLastYear(file: File) {
    setReading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ nextYear: number | null; taxpayers: string; items: { label: string; note: string; required: boolean }[] }>(`/api/workspaces/${wid}/clients/prior-year`, { method: "POST", body: form });
      if (!r.items.length) throw new Error("No income sources or deductions were found in that file. Is it a tax return?");
      setTemplate("ai");
      if (r.nextYear) setYear(r.nextYear);
      setTitle(`${r.nextYear ?? year} tax documents`);
      setMessage("Based on last year's return, here's what we need this year. If something doesn't apply anymore, just mark it that way.");
      setItems(r.items.map((i) => ({ ...i, accept: "any" as Accept })));
      toast(`Built a ${r.items.length}-item checklist from ${r.taxpayers || "last year's return"}. Review it before sending.`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setReading(false);
    }
  }

  const ready = title.trim() && items.some((i) => i.label.trim());
  async function send() {
    setBusy(true);
    const spec = {
      title: title.trim(),
      message,
      dueDate: due || null,
      items: items.filter((i) => i.label.trim()).map((i) => ({ label: i.label.trim(), note: i.note.trim() || undefined, required: i.required, accept: i.accept })),
      verify,
      expiresInDays: 120,
      autoRemind,
      packet: false,
      year,
    };
    try {
      if (target.kind === "one") {
        const r = await api<{ delivered: boolean; mailError: string | null; accessCode: string | null }>(`/api/workspaces/${wid}/clients/${target.id}`, {
          method: "POST",
          json: { action: "request", spec, repeat: repeat ? { every: repeat, startAt: Date.now() } : null },
        });
        toast(r.delivered ? `Request sent to ${target.name}.` : `Request created, but the email didn't go out${r.mailError ? `: ${r.mailError}` : "."}`, r.delivered ? "success" : "error");
        if (r.accessCode) window.alert(`Access code for ${target.name}: ${r.accessCode}\n\nShare it by phone or text. It won't be shown again.`);
      } else {
        const r = await api<{ sent: number; failed: number }>(`/api/workspaces/${wid}/clients/bulk`, {
          method: "POST",
          json: { ...(target.kind === "many" ? { clientIds: target.ids } : { tag: target.tag }), spec: { ...spec, verify: verify === "code" ? "email" : verify } },
        });
        toast(`Sent to ${r.sent} client${r.sent === 1 ? "" : "s"}${r.failed ? `; ${r.failed} email(s) didn't go out` : ""}.`, r.failed ? "error" : "success");
      }
      onSent();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const who = target.kind === "one" ? target.name : target.kind === "many" ? `${target.ids.length} clients` : `${target.count} clients tagged “${target.tag}”`;
  const setItem = (i: number, patch: Partial<Item>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal
      wide
      title={`Request documents from ${who}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={send}>
            {busy ? "Sending…" : target.kind === "one" ? "Send request" : `Send to ${who}`}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div>
          <div className="fa-label">Start from</div>
          <div className="fa-chips">
            {GENERAL.map((t) => (
              <button key={t.key} type="button" className={`fa-chip-btn ${template === t.key ? "on" : ""}`} onClick={() => pick(t.key)}>
                {t.name}
              </button>
            ))}
            <button type="button" className={`fa-chip-btn ${template === "blank" ? "on" : ""}`} onClick={() => pick("blank")}>
              Blank (your own list)
            </button>
          </div>
          <div className="fa-label mt-12">Tax and accounting</div>
          <div className="fa-chips">
            {FIRM_TEMPLATES.map((t) => (
              <button key={t.key} type="button" className={`fa-chip-btn ${template === t.key ? "on" : ""}`} onClick={() => pick(t.key)}>
                {t.name}
              </button>
            ))}
          </div>
          <div className={`fa-ai-card ${template === "ai" ? "on" : ""}`}>
            <span className="fa-ai-ico"><I.sparkle size={18} /></span>
            <div className="grow">
              <b>Build a tax checklist from last year’s return</b>
              <div className="small muted">Upload the client’s prior-year return (PDF). AI lists a W-2 for each employer, a 1099 for each bank or broker, the 1098s and more. Uses AI credits.</div>
            </div>
            <button type="button" className="btn btn-tonal btn-sm" disabled={reading} onClick={() => fileRef.current?.click()}>
              {reading ? (
                <>
                  <span className="spinner" /> Reading…
                </>
              ) : (
                <>
                  <I.upload size={14} /> Upload return
                </>
              )}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && fromLastYear(e.target.files[0])} />
          </div>
        </div>

        <div className="fa-grid2">
          <div className="field">
            <label htmlFor="rb-title">Title</label>
            <input id="rb-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="row gap-12">
            <div className="field grow">
              <label htmlFor="rb-year">Fiscal year</label>
              <select id="rb-year" className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[year0 + 1, year0, year0 - 1, year0 - 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="rb-due">Due date</label>
              <input id="rb-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="rb-msg">Message to the client</label>
          <textarea id="rb-msg" className="textarea" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div>
          <div className="fa-label">Checklist ({items.filter((i) => i.label.trim()).length})</div>
          <div className="fa-items">
            {items.map((it, i) => (
              <div key={i} className="fa-item-row">
                <span className="fa-item-n">{i + 1}</span>
                <div className="grow col" style={{ gap: 4 }}>
                  <input className="input" value={it.label} placeholder="What to upload, e.g. W-2 from Acme Corp" onChange={(e) => setItem(i, { label: e.target.value })} aria-label="Item" />
                  <input className="input input-sm" value={it.note} placeholder="Hint for the client (optional)" onChange={(e) => setItem(i, { note: e.target.value })} aria-label="Hint" />
                </div>
                <div className="fa-item-opts">
                  <select className="select input-sm" value={it.accept} onChange={(e) => setItem(i, { accept: e.target.value as Accept })} aria-label="File type">
                    {(Object.keys(ACCEPT_LABEL) as Accept[]).map((a) => (
                      <option key={a} value={a}>
                        {ACCEPT_LABEL[a]}
                      </option>
                    ))}
                  </select>
                  <label className="check small">
                    <input type="checkbox" checked={it.required} onChange={(e) => setItem(i, { required: e.target.checked })} /> Required
                  </label>
                </div>
                <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                  <I.x size={16} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setItems((l) => [...l, blankItem()])}>
            <I.plus size={14} /> Add item
          </button>
        </div>

        <div className="fa-grid2">
          <div className="field">
            <label htmlFor="rb-verify">Before the checklist opens</label>
            <select id="rb-verify" className="select" value={verify} onChange={(e) => setVerify(e.target.value as typeof verify)}>
              <option value="email">Client confirms a code we email them (recommended)</option>
              {target.kind === "one" && <option value="code">Client enters an access code you give them</option>}
              <option value="none">Anyone with the link can open it</option>
            </select>
            <span className="small faint">In their portal, clients are already signed in.</span>
          </div>
          <div className="col gap-8">
            <label className="check">
              <input type="checkbox" checked={autoRemind} onChange={(e) => setAutoRemind(e.target.checked)} />
              <span>
                <b>Remind automatically</b>
                <br />
                <span className="small muted">After 3, 7 and 14 days (or around the due date), in one combined email. Stops when everything’s in.</span>
              </span>
            </label>
            {target.kind === "one" && (
              <div className="field">
                <label htmlFor="rb-repeat">Repeat</label>
                <select id="rb-repeat" className="select" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                  <option value="">Just once</option>
                  <option value="month">Every month</option>
                  <option value="quarter">Every quarter</option>
                  <option value="year">Every year</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
