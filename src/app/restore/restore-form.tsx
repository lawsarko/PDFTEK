"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo, Wordmark } from "@/components/icons";

/** Visitors who paid without an account recover their purchase with the email they used at checkout. */
export function RestoreForm() {
  const expired = useSearchParams().get("expired");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(expired ? "That link has expired or was already used. Request a new one below." : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/billing/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(data.error ?? "Something went wrong. Try again.");
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Link href="/" className="brand" style={{ marginBottom: 22 }}>
          <Logo /> <Wordmark />
        </Link>
        <h1 style={{ fontSize: 22 }}>Restore a purchase</h1>
        {done ? (
          <p className="muted">
            If <b>{email}</b> was used to buy a Day Pass, Pro or credits, we&apos;ve emailed a link to get back to it. Check your inbox (and spam folder). The link works once and expires soon.
          </p>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 4 }}>
              Bought without an account, then switched devices or cleared your browser? Enter the email you used at checkout and we&apos;ll send you a link.
            </p>
            <div className="field mt-16">
              <label htmlFor="email">Email used at checkout</label>
              <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            {error && <div className="error-text mt-8">{error}</div>}
            <button className="btn btn-primary btn-lg mt-16" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
              {busy && <span className="spinner" />} Email me a link
            </button>
          </>
        )}
        <p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>
          Have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
