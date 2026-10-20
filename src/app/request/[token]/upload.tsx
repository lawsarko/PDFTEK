"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { I, Logo, Wordmark } from "@/components/icons";
import { ACCEPT_EXT, type Accept } from "@/lib/request-templates";

type Item = {
  id: string;
  label: string;
  note: string;
  required: boolean;
  accept: Accept;
  acceptLabel: string;
  status: "needed" | "uploaded" | "returned";
  files: string[];
  feedback: string | null;
  uploadedAt: number | null;
};
type Info = {
  title: string;
  requester: string;
  workspaceName: string;
  recipientName: string;
  status: string;
  verify: "none" | "email" | "code";
  emailHint: string;
  expiresAt: number | null;
  locked: boolean;
  lockedUntil: number | null;
  message?: string;
  dueDate?: string | null;
  items?: Item[];
};

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function RequestUpload({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Info>(`/api/public/requests/${token}`).then(setInfo).catch((e) => setError(errMsg(e))), [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const items = info?.items ?? [];
  const missing = items.filter((i) => i.required && i.status !== "uploaded");
  const received = items.filter((i) => i.status === "uploaded").length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/public/requests/${token}/submit`, { method: "POST" });
      setDone(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const closed = info && (done || info.status === "complete" || info.status === "cancelled" || info.status === "expired");

  return (
    <div className="auth-wrap">
      <div className="auth-card rq-card">
        <span className="brand" style={{ marginBottom: 20 }}>
          <Logo /> <Wordmark />
        </span>
        {!info && !error && <span className="spinner" />}
        {error && !info && (
          <>
            <h1 style={{ fontSize: 22 }}>Link unavailable</h1>
            <p className="muted">{error}</p>
          </>
        )}
        {info && closed ? (
          <Closed info={info} done={done} />
        ) : info?.locked ? (
          <Verify token={token} info={info} onVerified={load} />
        ) : info ? (
          <>
            <div className="eyebrow">{info.workspaceName}</div>
            <h1 style={{ fontSize: 22, marginTop: 6 }}>
              {info.requester} requested: {info.title}
            </h1>
            <div className="row wrap small muted mt-8" style={{ gap: 14 }}>
              {info.dueDate && (
                <span>
                  <I.clock size={12} /> Due {info.dueDate}
                </span>
              )}
              {info.expiresAt && (
                <span>
                  <I.lock size={12} /> Link open until {fmtDate(info.expiresAt)}
                </span>
              )}
            </div>
            {info.message && (
              <div className="card card-tight small mt-12" style={{ whiteSpace: "pre-wrap" }}>
                {info.message}
              </div>
            )}

            <div className="rq-progress mt-16" aria-label={`${received} of ${items.length} received`}>
              <div className="row between small">
                <b>Checklist</b>
                <span className="muted">
                  {received} of {items.length} uploaded
                </span>
              </div>
              <div className="rq-bar">
                <span style={{ width: `${items.length ? (received / items.length) * 100 : 0}%` }} />
              </div>
            </div>

            <div className="col gap-8 mt-12">
              {items.map((it) => (
                <ItemCard key={it.id} token={token} item={it} onChange={(next) => setInfo({ ...info, items: items.map((x) => (x.id === next.id ? next : x)) })} />
              ))}
            </div>

            {error && <div className="error-text mt-12">{error}</div>}
            <button className="btn btn-primary btn-lg mt-16" style={{ width: "100%" }} disabled={busy || missing.length > 0 || received === 0} onClick={submit}>
              {busy && <span className="spinner" />} Send to {info.requester}
            </button>
            {missing.length > 0 && (
              <p className="tiny muted mt-8" style={{ textAlign: "center" }}>
                Still needed: {missing.map((i) => i.label).join(", ")}
              </p>
            )}
            <SecurityNote info={info} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ItemCard({ token, item, onChange }: { token: string; item: Item; onChange: (i: Item) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const exts = ACCEPT_EXT[item.accept];

  const upload = async (list: FileList | File[]) => {
    const files = [...list];
    if (!files.length) return;
    const bad = exts && files.find((f) => !exts.includes((f.name.split(".").pop() || "").toLowerCase()));
    if (bad) return setError(`${bad.name}: this item needs ${item.acceptLabel === "PDF only" ? "a PDF" : item.acceptLabel.toLowerCase()}.`);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("itemId", item.id);
      files.forEach((f) => form.append("files", f));
      const r = await api<{ item: Item }>(`/api/public/requests/${token}`, { method: "POST", body: form });
      onChange(r.item);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const done = item.status === "uploaded";
  return (
    <div
      className={`rq-item ${done ? "done" : ""} ${item.status === "returned" ? "returned" : ""} ${over ? "over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <span className="rq-check">{done ? <I.check size={14} /> : <I.file size={14} />}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <b className="small">{item.label}</b>
          {!item.required && <span className="badge badge-muted">Optional</span>}
        </div>
        {item.note && <div className="tiny muted">{item.note}</div>}
        {item.status === "returned" && item.feedback && (
          <div className="tiny rq-feedback">
            <I.info size={11} /> Please upload a new copy: {item.feedback}
          </div>
        )}
        {done ? (
          <div className="tiny faint ellipsis">
            <I.check size={10} /> {item.files.join(", ")}
          </div>
        ) : (
          <div className="tiny faint">{item.acceptLabel} · drop files here or choose</div>
        )}
        {error && <div className="error-text tiny">{error}</div>}
      </div>
      <button className={`btn btn-sm ${done ? "btn-ghost" : ""}`} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : <I.upload size={12} />} {done ? "Replace" : "Upload"}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={exts ? exts.map((e) => `.${e}`).join(",") : undefined}
        onChange={(e) => e.target.files && void upload(e.target.files)}
      />
    </div>
  );
}

function Verify({ token, info, onVerified }: { token: string; info: Info; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const email = info.verify === "email";

  const send = async () => {
    setBusy("send");
    setError(null);
    try {
      await api(`/api/public/requests/${token}/verify`, { method: "POST", json: { action: "send" } });
      setSent(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
    setBusy("check");
    setError(null);
    try {
      await api(`/api/public/requests/${token}/verify`, { method: "POST", json: { code } });
      onVerified();
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  };

  return (
    <>
      <div className="rq-shield">
        <I.shield size={22} />
      </div>
      <h1 style={{ fontSize: 22, marginTop: 12 }}>Secure document request</h1>
      <p className="muted">
        {info.requester} at {info.workspaceName} asked you, {info.recipientName}, for documents.{" "}
        {email ? "To keep them safe, first confirm it's you with a code sent to your email." : `To keep them safe, enter the access code ${info.requester} gave you.`}
      </p>
      {email && !sent ? (
        <button className="btn btn-primary btn-lg" style={{ width: "100%" }} disabled={!!busy} onClick={send}>
          {busy === "send" && <span className="spinner" />} Email a code to {info.emailHint}
        </button>
      ) : (
        <form
          className="col gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          {email && <div className="small muted">We sent a 6-digit code to {info.emailHint}. It expires in 10 minutes.</div>}
          <input
            className="input rq-code"
            autoFocus
            autoComplete="one-time-code"
            inputMode={email ? "numeric" : "text"}
            placeholder={email ? "123456" : "ABCD-1234"}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label={email ? "Verification code" : "Access code"}
          />
          <button className="btn btn-primary btn-lg" disabled={!!busy || code.replace(/[\s-]/g, "").length < (email ? 6 : 8)}>
            {busy === "check" && <span className="spinner" />} Continue
          </button>
          {email && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={send}>
              Send a new code
            </button>
          )}
        </form>
      )}
      {error && <div className="error-text mt-12">{error}</div>}
      <SecurityNote info={info} />
    </>
  );
}

function Closed({ info, done }: { info: Info; done: boolean }) {
  if (done || info.status === "complete")
    return (
      <>
        <div className="rq-shield good">
          <I.check size={22} />
        </div>
        <h1 style={{ fontSize: 22, marginTop: 12 }}>Thank you, {info.recipientName}!</h1>
        <p className="muted">
          Your documents were delivered securely to {info.requester} at {info.workspaceName}. You can close this page. If {info.requester} needs anything else, you&apos;ll get an
          email.
        </p>
      </>
    );
  return (
    <>
      <h1 style={{ fontSize: 22 }}>{info.status === "expired" ? "This link has expired" : "Request cancelled"}</h1>
      <p className="muted">
        {info.status === "expired" ? `Ask ${info.requester} to extend the request or send a new link.` : `${info.requester} no longer needs these documents.`}
      </p>
    </>
  );
}

function SecurityNote({ info }: { info: Info }) {
  return (
    <ul className="rq-security">
      <li>
        <I.lock size={11} /> Sent over an encrypted connection (HTTPS)
      </li>
      {info.verify !== "none" && (
        <li>
          <I.check size={11} /> Protected by a one-time {info.verify === "email" ? "email code" : "access code"}
        </li>
      )}
      <li>
        <I.inbox size={11} /> Files go privately to {info.workspaceName}, no one else
      </li>
    </ul>
  );
}
