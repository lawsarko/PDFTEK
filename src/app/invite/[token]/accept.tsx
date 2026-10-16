"use client";
import { useState } from "react";
import { api, errMsg } from "@/lib/client/api";

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {error && <div className="error-text mt-12">{error}</div>}
      <button
        className="btn btn-primary btn-lg mt-16"
        style={{ width: "100%" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ workspaceId: string }>(`/api/invites/${token}`, { method: "POST" });
            window.location.href = `/app/${r.workspaceId}`;
          } catch (e) {
            setError(errMsg(e));
            setBusy(false);
          }
        }}
      >
        Accept invitation
      </button>
    </>
  );
}
