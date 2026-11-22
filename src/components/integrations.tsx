"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { WorkspaceInfo } from "@/lib/client/types";
import { I } from "./icons";
import { useToast } from "./toast";

type Payments = { available: boolean; accountId: string | null; ready: boolean };

/** Settings → Integrations: services connected to this workspace. */
export function IntegrationsTab({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  return (
    <div className="col gap-16">
      <div>
        <h2 style={{ margin: 0 }}>Integrations</h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Connect the services you already use, so documents and payments flow into pdftek without extra steps.</p>
      </div>
      <PaymentsCard wid={wid} info={info} />
    </div>
  );
}

function PaymentsCard({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  const toast = useToast();
  const [pay, setPay] = useState<Payments | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = info.role === "owner" || info.role === "admin";

  const load = useCallback(async () => {
    try {
      // Coming back from Stripe onboarding: check whether the account can take payments now.
      const back = new URLSearchParams(window.location.search).get("stripe") === "return";
      setPay(back && admin ? await api<Payments>(`/api/workspaces/${wid}/payments`, { method: "POST", json: { action: "refresh" } }) : await api<Payments>(`/api/workspaces/${wid}/payments`));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }, [wid, admin, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "connect" | "refresh" | "dashboard" | "disconnect") => {
    setBusy(action);
    try {
      const r = await api<Payments & { url?: string }>(`/api/workspaces/${wid}/payments`, { method: "POST", json: { action } });
      if (r.url) {
        if (action === "dashboard") window.open(r.url, "_blank", "noopener");
        else window.location.href = r.url;
      } else setPay(r);
      if (action === "disconnect") toast("Stripe disconnected from this workspace", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const state = !pay ? null : pay.ready ? "ready" : pay.accountId ? "pending" : "none";
  return (
    <section className="int-card">
      <div className="int-head">
        <span className="int-logo" style={{ background: "#635bff" }} aria-hidden>
          S
        </span>
        <div className="grow">
          <b>Payments with Stripe</b>
          <div className="small muted">Collect deposits, fees and registrations through your signing links. Money goes straight to your own Stripe account; pdftek never holds it.</div>
        </div>
        {state === "ready" && <span className="badge badge-good">Connected</span>}
        {state === "pending" && <span className="badge badge-warn">Setup not finished</span>}
      </div>
      {!pay ? (
        <span className="spinner" />
      ) : !pay.available ? (
        <p className="small muted" style={{ margin: 0 }}>Payments aren&apos;t available on this server.</p>
      ) : !admin ? (
        <p className="small muted" style={{ margin: 0 }}>Ask a workspace owner or admin to connect Stripe.</p>
      ) : (
        <div className="int-actions">
          {state === "none" && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void act("connect")}>
              {busy === "connect" ? <span className="spinner" /> : <I.link size={14} />} Connect Stripe
            </button>
          )}
          {state === "pending" && (
            <>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void act("connect")}>
                {busy === "connect" && <span className="spinner" />} Finish Stripe setup
              </button>
              <button className="btn" disabled={!!busy} onClick={() => void act("refresh")}>
                {busy === "refresh" && <span className="spinner" />} Check status
              </button>
            </>
          )}
          {state === "ready" && (
            <button className="btn" disabled={!!busy} onClick={() => void act("dashboard")}>
              {busy === "dashboard" && <span className="spinner" />} Open Stripe dashboard
            </button>
          )}
          {state !== "none" && (
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => confirm("Disconnect Stripe? Signing links stop collecting payments until you connect again. Your Stripe account itself isn't affected.") && void act("disconnect")}>
              Disconnect
            </button>
          )}
        </div>
      )}
      {state === "ready" && <p className="tiny faint" style={{ margin: 0 }}>Turn on “Collect a payment” when you create a signing link (E-signatures → Signing links).</p>}
    </section>
  );
}
