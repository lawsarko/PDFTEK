"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import { Logo, Wordmark } from "@/components/icons";

/** `accessToken` comes from a Supabase reset link (see /auth/confirm); otherwise pdftek's own ?token=. */
export function ResetForm({ accessToken }: { accessToken?: string }) {
  const urlToken = useSearchParams().get("token") ?? "";
  const token = accessToken ?? urlToken;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "This reset link is incomplete. Open the link from your email again, or request a new one.");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ workspaceId: string | null }>("/api/auth/reset", { method: "POST", json: accessToken ? { accessToken, password } : { token, password } });
      window.location.href = r.workspaceId ? `/app/${r.workspaceId}` : "/app";
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Link href="/" className="brand" style={{ marginBottom: 22 }}>
          <Logo /> <Wordmark />
        </Link>
        <h1 style={{ fontSize: 22 }}>Choose a new password</h1>
        <p className="small muted" style={{ margin: "6px 0 20px" }}>You&apos;ll be signed in right after, and signed out everywhere else.</p>
        <div className="col gap-12">
          <div className="field">
            <label htmlFor="password">New password</label>
            <input id="password" className="input" type="password" autoComplete="new-password" required minLength={8} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="tiny faint">At least 8 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm new password</label>
            <input id="confirm" className="input" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && (
            <div className="error-text">
              {error} {/expired|incomplete/.test(error) && <Link href="/forgot">Request a new link</Link>}
            </div>
          )}
          <button className="btn btn-primary btn-lg" disabled={busy || !token}>
            {busy && <span className="spinner" />} Save password and sign in
          </button>
        </div>
      </form>
    </div>
  );
}
