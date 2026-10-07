"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import { Logo, Wordmark } from "./icons";

export function AuthForm({ mode, inviteToken, inviteEmail, workspaceName }: { mode: "login" | "signup"; inviteToken?: string; inviteEmail?: string; workspaceName?: string }) {
  const params = useSearchParams();
  const next = params.get("next");
  const [form, setForm] = useState({ name: "", email: inviteEmail ?? "", password: "", workspaceName: "" });
  const [error, setError] = useState<string | null>(null);
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
            <label htmlFor="password">Password</label>
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
        {mode === "signup" && (
          <p className="tiny faint" style={{ textAlign: "center", marginTop: 8 }}>
            By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}
