"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { PdfViewer } from "@/components/pdf-viewer";
import { SignaturePad } from "@/components/signature-pad";
import { I, Logo } from "@/components/icons";
import { Modal } from "@/components/modal";

type Field = { id: string; page: number; x: number; y: number; w: number; h: number; kind: "signature" | "initials" | "date" | "name" | "text" };
type Info = {
  title: string;
  message: string;
  documentName: string;
  sender: string;
  workspaceName: string;
  pageCount: number;
  requestStatus: string;
  signer: { name: string; email: string; status: string };
  waitingFor: string | null;
  signers: { name: string; status: string }[];
  fields: Field[];
};

export function SignPage({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [initials, setInitials] = useState<string | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decline, setDecline] = useState(false);
  const [reason, setReason] = useState("");
  const [scale, setScale] = useState(1.2);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api<Info>(`/api/public/sign/${token}`));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [token]);
  useEffect(() => {
    void load();
    const fit = () => setScale(Math.max(0.5, Math.min(1.4, (window.innerWidth - (window.innerWidth > 960 ? 380 : 32)) / 640)));
    fit();
  }, [load]);

  if (error) return <Shell><div className="empty"><h3>Link unavailable</h3>{error}</div></Shell>;
  if (!info) return <Shell><div className="empty"><span className="spinner spinner-lg" /></div></Shell>;

  const done = info.signer.status === "signed";
  const closed = info.requestStatus !== "sent";
  const hasInitials = info.fields.some((f) => f.kind === "initials");
  const textFields = info.fields.filter((f) => f.kind === "text");
  const canFinish = sig && (!hasInitials || initials) && consent && textFields.every((f) => values[f.id]?.trim());

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/public/sign/${token}`, { method: "POST", json: { action: "sign", consent: true, signaturePng: sig, initialsPng: initials ?? undefined, values } });
      await load();
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Shell>
      <div className="main" style={{ height: "calc(100vh - 56px)" }}>
        <section className="viewer">
          <div className="page-scroll" ref={scrollRef}>
            <PdfViewer
              src={`/api/public/sign/${token}/file`}
              scale={scale}
              scrollRef={scrollRef}
              textLayer={false}
              renderOverlay={(p) => (
                <div style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }}>
                  {!done &&
                    info.fields
                      .filter((f) => f.page === p.page)
                      .map((f) => {
                        const style = { left: f.x * p.width, top: f.y * p.height, width: f.w * p.width, height: f.h * p.height, pointerEvents: "auto" as const };
                        if (f.kind === "text")
                          return (
                            <input
                              key={f.id}
                              className="input input-sm"
                              style={{ ...style, position: "absolute", background: "#fff8e8", color: "#111", border: "1.5px solid var(--amber)", padding: "0 4px", fontSize: Math.max(10, f.h * p.height * 0.55) }}
                              placeholder="Type here"
                              value={values[f.id] ?? ""}
                              onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                              disabled={closed}
                            />
                          );
                        const img = f.kind === "signature" ? sig : f.kind === "initials" ? initials : null;
                        return (
                          <button
                            key={f.id}
                            className="sig-field"
                            style={{ ...style, borderColor: "var(--amber)", background: img ? "transparent" : "rgba(217,142,43,.14)", color: "#8a5a17", cursor: "pointer" }}
                            onClick={() => !closed && (f.kind === "signature" || f.kind === "initials") && setAdopt(true)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {img ? <img src={img} alt="" /> : f.kind === "date" ? today : f.kind === "name" ? info.signer.name : f.kind === "initials" ? "Initial" : "Sign here"}
                          </button>
                        );
                      })}
                </div>
              )}
            />
          </div>
        </section>
        <aside className="assistant" style={{ width: 360 }}>
          <div className="panel-body">
            <div className="eyebrow">{info.workspaceName}</div>
            <h2 style={{ fontSize: 20 }}>{info.title}</h2>
            <div className="small muted">
              {info.sender} asked <b style={{ color: "var(--text-hi)" }}>{info.signer.name}</b> to review and sign <b style={{ color: "var(--text-hi)" }}>{info.documentName}</b> ({info.pageCount} pages).
            </div>
            {info.message && <div className="card card-tight small" style={{ whiteSpace: "pre-wrap" }}>{info.message}</div>}
            <div>
              {info.signers.map((s, i) => (
                <div key={i} className="row small mt-8">
                  <span className={`badge ${s.status === "signed" ? "badge-good" : s.status === "declined" ? "badge-bad" : "badge-muted"}`}>{s.status === "signed" ? "signed" : s.status === "declined" ? "declined" : "pending"}</span>
                  {s.name}
                </div>
              ))}
            </div>
            <hr className="divider" />
            {info.requestStatus === "completed" ? (
              <div className="col gap-12">
                <div className="notice" style={{ borderColor: "rgba(111,179,122,.5)", background: "var(--good-soft)" }}>
                  <b>Completed.</b> Everyone has signed. Download the final PDF, which includes the certificate of completion.
                </div>
                <a className="btn btn-primary" href={`/api/public/sign/${token}/file?signed=1`}>
                  <I.download size={14} /> Download signed PDF
                </a>
              </div>
            ) : done ? (
              <div className="notice" style={{ borderColor: "rgba(111,179,122,.5)", background: "var(--good-soft)" }}>
                <b>Thanks — you’ve signed.</b> We’ll email you the final copy once everyone has signed.
              </div>
            ) : closed ? (
              <div className="notice notice-bad">This signing request is no longer active ({info.requestStatus}).</div>
            ) : info.waitingFor ? (
              <div className="notice">You can review the document now. You’ll be able to sign after <b>{info.waitingFor}</b> has signed.</div>
            ) : (
              <div className="col gap-12">
                <button className="btn" onClick={() => setAdopt(true)}>
                  <I.sign size={14} /> {sig ? "Change signature" : "Adopt your signature"}
                </button>
                {textFields.length > 0 && <div className="small muted">Fill in the {textFields.length} highlighted text field{textFields.length > 1 ? "s" : ""} on the document.</div>}
                <label className="check">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  I agree to sign this document electronically, and that my electronic signature is as legally binding as a handwritten one.
                </label>
                <button className="btn btn-primary btn-lg" disabled={!canFinish || busy} onClick={submit}>
                  {busy && <span className="spinner" />} Finish & sign
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDecline(true)}>
                  Decline to sign
                </button>
              </div>
            )}
            <div className="tiny faint mt-12">
              <I.shield size={11} /> Your IP address and timestamp are recorded in the audit certificate attached to the signed document.
            </div>
          </div>
        </aside>
      </div>
      {adopt && (
        <Modal
          title="Adopt your signature"
          onClose={() => setAdopt(false)}
          footer={
            <button className="btn btn-primary" disabled={!sig || (hasInitials && !initials)} onClick={() => setAdopt(false)}>
              Adopt and continue
            </button>
          }
        >
          <SignaturePad name={info.signer.name} onChange={setSig} />
          {hasInitials && (
            <div className="mt-16">
              <div className="label" style={{ marginBottom: 6 }}>Initials</div>
              <SignaturePad name={info.signer.name.split(/\s+/).map((p) => p[0]).join("").toUpperCase()} onChange={setInitials} height={90} />
            </div>
          )}
        </Modal>
      )}
      {decline && (
        <Modal
          title="Decline to sign"
          onClose={() => setDecline(false)}
          footer={
            <>
              <button className="btn" onClick={() => setDecline(false)}>Back</button>
              <button
                className="btn btn-danger"
                disabled={!reason.trim()}
                onClick={async () => {
                  try {
                    await api(`/api/public/sign/${token}`, { method: "POST", json: { action: "decline", reason } });
                    setDecline(false);
                    await load();
                  } catch (e) {
                    alert(errMsg(e));
                  }
                }}
              >
                Decline
              </button>
            </>
          }
        >
          <div className="field">
            <label>Let {info.sender} know why</label>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-wrap">
      <header className="public-head">
        <span className="brand">
          <Logo /> pdftek <span className="faint small" style={{ fontWeight: 400, fontFamily: "var(--font-body)" }}>e-sign</span>
        </span>
        <span className="tiny faint mono">
          <I.lock size={11} /> Secure signing link
        </span>
      </header>
      {children}
    </div>
  );
}
