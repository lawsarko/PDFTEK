"use client";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { I, Logo } from "@/components/icons";

type Info = { title: string; message: string; recipientName: string; dueDate: string | null; status: string; workspaceName: string; requester: string };

export function RequestUpload({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Info>(`/api/public/requests/${token}`).then(setInfo).catch((e) => setError(errMsg(e)));
  }, [token]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      await api(`/api/public/requests/${token}`, { method: "POST", body: form });
      setDone(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <span className="brand" style={{ marginBottom: 20 }}>
          <Logo /> pdftek
        </span>
        {!info && !error && <span className="spinner" />}
        {error && !info && (
          <>
            <h1 style={{ fontSize: 22 }}>Link unavailable</h1>
            <p className="muted">{error}</p>
          </>
        )}
        {info && (done || info.status === "complete") ? (
          <>
            <h1 style={{ fontSize: 22 }}>Thank you, {info.recipientName}!</h1>
            <p className="muted">
              Your upload was delivered securely to {info.requester} at {info.workspaceName}. You can close this page.
            </p>
          </>
        ) : info && info.status === "cancelled" ? (
          <>
            <h1 style={{ fontSize: 22 }}>Request cancelled</h1>
            <p className="muted">{info.requester} no longer needs this document.</p>
          </>
        ) : info ? (
          <>
            <div className="eyebrow">{info.workspaceName}</div>
            <h1 style={{ fontSize: 22, marginTop: 6 }}>{info.requester} requested: {info.title}</h1>
            {info.dueDate && <div className="small muted mt-8">Due by {info.dueDate}</div>}
            {info.message && <div className="card card-tight small mt-12" style={{ whiteSpace: "pre-wrap" }}>{info.message}</div>}
            <div
              className={`dropzone mt-16 ${over ? "over" : ""}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                setFiles([...files, ...e.dataTransfer.files]);
              }}
            >
              <I.upload size={24} />
              <div style={{ marginTop: 8 }}>Drag files here or <span style={{ color: "var(--amber)" }}>browse</span></div>
              <div className="tiny faint mt-8">PDF, Word, Excel, PowerPoint, JPG or PNG · up to 60 MB</div>
              <input ref={input} type="file" multiple hidden onChange={(e) => setFiles([...files, ...(e.target.files ?? [])])} />
            </div>
            {files.map((f, i) => (
              <div key={i} className="row small mt-8">
                <I.file size={14} /> <span className="grow ellipsis">{f.name}</span>
                <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">
                  <I.x size={12} />
                </button>
              </div>
            ))}
            {error && <div className="error-text mt-12">{error}</div>}
            <button className="btn btn-primary btn-lg mt-16" style={{ width: "100%" }} disabled={!files.length || busy} onClick={submit}>
              {busy && <span className="spinner" />} Upload securely
            </button>
            <p className="tiny faint mt-12" style={{ textAlign: "center" }}>
              <I.lock size={11} /> Files go directly to {info.workspaceName}&apos;s private pdftek workspace.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
