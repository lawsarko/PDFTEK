"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import { I, Logo, Wordmark } from "@/components/icons";

export function ForgotForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot", { method: "POST", json: { email } });
      setSent(true);
    } catch (err) {
      setError(errMsg(err));
    }
    setBusy(false);
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Link href="/" className="brand" style={{ marginBottom: 22 }}>
          <Logo /> <Wordmark />
        </Link>
        <h1 style={{ fontSize: 22 }}>Forgot your password?</h1>
        {sent ? (
          <div className="col gap-12" style={{ marginTop: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>
              <I.mail size={14} /> If an account exists for <b>{email}</b>, we&apos;ve sent a link to reset your password. It expires in 1 hour.
            </p>
            <p className="tiny faint" style={{ margin: 0 }}>Nothing arrived? Check your spam folder, or try again in a few minutes.</p>
            <Link href="/login" className="btn btn-lg">Back to sign in</Link>
          </div>
        ) : (
          <>
            <p className="small muted" style={{ margin: "6px 0 20px" }}>Enter your account email and we&apos;ll send you a link to choose a new one.</p>
            <div className="col gap-12">
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary btn-lg" disabled={busy}>
                {busy && <span className="spinner" />} Send reset link
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>
              Remembered it? <Link href="/login">Sign in</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
