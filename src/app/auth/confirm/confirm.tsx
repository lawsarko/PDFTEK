"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { Logo, Wordmark } from "@/components/icons";
import { ResetForm } from "@/app/reset/reset-form";

type State = { kind: "loading" } | { kind: "recovery"; accessToken: string } | { kind: "error"; message: string };

/**
 * Supabase puts the session in the URL fragment (#access_token=…&type=…), which never reaches the
 * server, so this page reads it and hands it to the API once.
 */
export function Confirm() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    // Keep tokens out of history and out of anything copied from the address bar.
    window.history.replaceState(null, "", window.location.pathname);
    const accessToken = hash.get("access_token");
    const type = hash.get("type");
    if (!accessToken) {
      const code = hash.get("error_code");
      setState({
        kind: "error",
        message: code === "otp_expired" ? "This link has expired or was already used." : (hash.get("error_description") ?? "This link isn't valid.").replace(/\+/g, " "),
      });
      return;
    }
    if (type === "recovery") {
      setState({ kind: "recovery", accessToken });
      return;
    }
    api<{ workspaceId: string }>("/api/auth/session", { method: "POST", json: { accessToken } })
      .then((r) => {
        window.location.replace(`/app/${r.workspaceId}${type === "signup" || type === "email_change" ? "?verified=1" : ""}`);
      })
      .catch((e) => setState({ kind: "error", message: errMsg(e) }));
  }, []);

  if (state.kind === "recovery") {
    return (
      <Suspense>
        <ResetForm accessToken={state.accessToken} />
      </Suspense>
    );
  }
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand" style={{ marginBottom: 22 }}>
          <Logo /> <Wordmark />
        </Link>
        {state.kind === "loading" ? (
          <p className="muted row" style={{ gap: 10 }}>
            <span className="spinner" /> Signing you in…
          </p>
        ) : (
          <div className="col gap-12">
            <h1 style={{ fontSize: 22 }}>That link didn&apos;t work</h1>
            <p className="small muted" style={{ margin: 0 }}>
              {state.message} Links from our emails work once and expire after a while.
            </p>
            <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>
            <p className="small" style={{ textAlign: "center", margin: 0 }}>
              <Link href="/forgot">Reset your password</Link> · <Link href="/restore">Restore a purchase</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
