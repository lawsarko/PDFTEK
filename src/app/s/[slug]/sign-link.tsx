"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { I, Logo, Wordmark } from "@/components/icons";

type Info = {
  title: string;
  message: string;
  from: string;
  sender: string;
  pageCount: number;
  verifyEmail: boolean;
  payment: { amount: string; description: string } | null;
  closed: string | null;
};

/** Public signing link: the visitor enters their name and email (confirmed by a code), then signs. */
export function SignLinkPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [codeId, setCodeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Info>(`/api/public/sign-links/${slug}`)
      .then(setInfo)
      .catch((e) => setError(errMsg(e)));
  }, [slug]);

  const go = (r: { url?: string; needCode?: boolean; codeId?: string }) => {
    if (r.needCode && r.codeId) {
      setCodeId(r.codeId);
      setBusy(false);
    } else if (r.url) window.location.href = r.url;
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      go(await api(`/api/public/sign-links/${slug}`, { method: "POST", json: { action: "start", name, email } }));
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      go(await api(`/api/public/sign-links/${slug}`, { method: "POST", json: { action: "verify", codeId, code } }));
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card rq-card">
        <span className="brand" style={{ marginBottom: 20 }}>
          <Logo /> <Wordmark />
        </span>
        {!info && !error && <span className="spinner" />}
        {!info && error && (
          <>
            <h1 style={{ fontSize: 22 }}>Link unavailable</h1>
            <p className="muted">{error}</p>
          </>
        )}
        {info?.closed ? (
          <>
            <h1 style={{ fontSize: 22 }}>{info.title}</h1>
            <p className="muted">{info.closed}</p>
          </>
        ) : info && !codeId ? (
          <>
            <div className="eyebrow">{info.from}</div>
            <h1 style={{ fontSize: 22, marginTop: 6 }}>{info.title}</h1>
            <div className="row wrap small muted mt-8" style={{ gap: 14 }}>
              <span>
                <I.file size={12} /> {info.pageCount} page{info.pageCount === 1 ? "" : "s"} to review and sign
              </span>
              {info.payment && (
                <span>
                  <I.bolt size={12} /> {info.payment.amount} payment after signing
                </span>
              )}
            </div>
            {info.message && (
              <div className="card card-tight small mt-12" style={{ whiteSpace: "pre-wrap" }}>
                {info.message}
              </div>
            )}
            <form
              className="col gap-12 mt-16"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <div className="field">
                <label htmlFor="sl-name">Your full name</label>
                <input id="sl-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As it should appear on the document" />
              </div>
              <div className="field">
                <label htmlFor="sl-email">Your email</label>
                <input id="sl-email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <span className="tiny faint">{info.verifyEmail ? "We'll send a code to confirm it's you, and email you the signed copy." : "We'll email you the signed copy."}</span>
              </div>
              <button className="btn btn-primary btn-lg" disabled={busy || name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
                {busy && <span className="spinner" />} {info.verifyEmail ? "Continue" : "Review and sign"}
              </button>
            </form>
            {error && <div className="error-text mt-12">{error}</div>}
            {info.payment && (
              <p className="tiny faint mt-12">
                After signing you&apos;ll pay {info.payment.amount}
                {info.payment.description ? ` (${info.payment.description})` : ""} securely with Stripe. pdftek never sees your card details.
              </p>
            )}
          </>
        ) : info ? (
          <>
            <div className="rq-shield">
              <I.mail size={22} />
            </div>
            <h1 style={{ fontSize: 22, marginTop: 12 }}>Check your email</h1>
            <p className="muted">We sent a 6-digit code to {email}. Enter it to open the document. It expires in 15 minutes.</p>
            <form
              className="col gap-8"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <input className="input rq-code" autoFocus autoComplete="one-time-code" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Verification code" />
              <button className="btn btn-primary btn-lg" disabled={busy || code.length < 6}>
                {busy && <span className="spinner" />} Open the document
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  setCodeId(null);
                  setCode("");
                }}
              >
                Use a different email, or send a new code
              </button>
            </form>
            {error && <div className="error-text mt-12">{error}</div>}
          </>
        ) : null}
        <ul className="rq-security">
          <li>
            <I.lock size={12} /> Your signature is recorded with the date, time and your IP address on a certificate of completion.
          </li>
          <li>
            <I.shield size={12} /> No account needed. Powered by pdftek e-sign.
          </li>
        </ul>
      </div>
    </div>
  );
}
