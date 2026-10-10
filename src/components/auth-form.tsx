"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import { Logo, Wordmark } from "./icons";

const NOTICES: Record<string, string> = {
  google: "Google sign-in didn't complete. Try again, or use your email and password.",
};

export function AuthForm({
  mode,
  inviteToken,
  inviteEmail,
  workspaceName,
  google,
}: {
  mode: "login" | "signup";
  inviteToken?: string;
  inviteEmail?: string;
  workspaceName?: string;
  google?: boolean;
}) {
  const params = useSearchParams();
  const next = params.get("next");
  const [form, setForm] = useState({ name: "", email: inviteEmail ?? "", password: "", workspaceName: "" });
  const [error, setError] = useState<string | null>(() => {
    const e = params.get("error");
    if (e) return NOTICES[e] ?? NOTICES.google;
    if (params.get("verified") === "0") return "That confirmation link has expired or was already used. Sign in and we'll send a new one.";
    return null;
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ workspaceId: string | null }>(`/api/auth/${mode}`, {
        method: "POST",
        json: mode === "login" ? { email: form.email, password: form.password } : { ...form, inviteToken, workspaceName: form.workspaceName || undefined },
      });
      if (inviteToken && mode === "login") {
        const acc = await api<{ workspaceId: string }>(`/api/invites/${inviteToken}`, { method: "POST" });
        window.location.href = `/app/${acc.workspaceId}`;
        return;
      }
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : r.workspaceId ? `/app/${r.workspaceId}` : "/app";
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
        <h1 style={{ fontSize: 22 }}>{mode === "login" ? "Welcome back" : workspaceName ? `Join ${workspaceName}` : "Create your workspace"}</h1>
        <p className="small muted" style={{ margin: "6px 0 20px" }}>
          {mode === "login" ? "Sign in to your document workbench." : "Free forever for the essentials. No credit card required."}
        </p>
        {google && !inviteToken && (
          <>
            <a className="btn btn-lg btn-google" href={`/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
              <GoogleG /> Continue with Google
            </a>
            <div className="auth-divider">
              <span>or with email</span>
            </div>
          </>
        )}
        <div className="col gap-12">
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" className="input" autoComplete="name" required value={form.name} onChange={set("name")} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={form.email} onChange={set("email")} readOnly={!!inviteEmail && mode === "signup"} />
          </div>
          <div className="field">
            <div className="row between">
              <label htmlFor="password">Password</label>
              {mode === "login" && (
                <Link href={`/forgot${form.email ? `?email=${encodeURIComponent(form.email)}` : ""}`} className="tiny" tabIndex={-1}>
                  Forgot password?
                </Link>
              )}
            </div>
            <input id="password" className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : 1} value={form.password} onChange={set("password")} />
            {mode === "signup" && <span className="tiny faint">At least 8 characters.</span>}
          </div>
          {mode === "signup" && !inviteToken && (
            <div className="field">
              <label htmlFor="ws">Workspace name (optional)</label>
              <input id="ws" className="input" placeholder="e.g. Acme Legal" value={form.workspaceName} onChange={set("workspaceName")} />
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            {busy && <span className="spinner" />} {mode === "login" ? "Sign in" : inviteToken ? "Join workspace" : "Create account"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>
          {mode === "login" ? (
            <>
              New to pdftek? <Link href={`/signup${inviteToken ? `?invite=${inviteToken}` : ""}`}>Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href={`/login${inviteToken ? `?invite=${inviteToken}` : next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
            </>
          )}
        </p>
        {!inviteToken && (
          <p className="small" style={{ textAlign: "center", marginTop: 10 }}>
            <Link prefetch={false} href="/go/start">Continue without an account →</Link>
            {mode === "login" && (
              <>
                <br />
                <Link href="/restore" className="tiny">Bought without an account? Restore your purchase</Link>
              </>
            )}
          </p>
        )}
        {mode === "signup" && (
          <p className="tiny faint" style={{ textAlign: "center", marginTop: 8 }}>
            By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}

/** Google's "G" mark, as their branding guidelines ask for on sign-in buttons. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
