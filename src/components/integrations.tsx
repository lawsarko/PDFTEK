"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { WorkspaceInfo } from "@/lib/client/types";
import { I } from "./icons";
import { useToast } from "./toast";
import { CloudMark, useCloud } from "./cloud";

type Payments = { available: boolean; accountId: string | null; ready: boolean };

/** Settings → Integrations: services connected to this workspace. */
export function IntegrationsTab({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  return (
    <div className="col gap-16">
      <div>
        <h2 style={{ margin: 0 }}>Integrations</h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Connect the services you already use, so documents and payments flow into pdftek without extra steps.</p>
      </div>
      <CloudCard />
      <EmailInCard wid={wid} info={info} />
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

function CloudCard() {
  const toast = useToast();
  const { list, connect, disconnect } = useCloud();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("cloud")) toast("Connected. You can now open files from it and save results back.", "success");
    if (p.get("cloud_error")) toast(p.get("cloud_error")!, "error");
  }, [toast]);
  const usable = (list ?? []).filter((c) => c.available);
  return (
    <section className="int-card">
      <div className="int-head">
        <span className="int-logo" style={{ background: "var(--info)" }} aria-hidden>
          <I.folder size={18} />
        </span>
        <div className="grow">
          <b>Cloud storage</b>
          <div className="small muted">Open files from Google Drive, Dropbox or OneDrive (Upload → From cloud), and save results back with ⋯ → Save to cloud. Connections are personal: each teammate connects their own account.</div>
        </div>
      </div>
      {list === null ? (
        <span className="spinner" />
      ) : !usable.length ? (
        <p className="small muted" style={{ margin: 0 }}>Cloud storage isn&apos;t set up on this server yet.</p>
      ) : (
        <div className="col gap-8">
          {usable.map((c) => (
            <div key={c.provider} className="cloud-save-row">
              <CloudMark provider={c.provider} />
              <span className="grow" style={{ minWidth: 0 }}>
                <b className="small">{c.name}</b>
                <span className="tiny faint ellipsis" style={{ display: "block" }}>
                  {c.connected ? `Connected${c.account ? ` as ${c.account}` : ""}` : "Not connected"}
                </span>
              </span>
              {c.connected ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    confirm(`Disconnect ${c.name}? Files you already opened stay in pdftek.`) &&
                    disconnect(c.provider).then(
                      () => toast(`${c.name} disconnected`, "success"),
                      (e) => toast(errMsg(e), "error"),
                    )
                  }
                >
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => connect(c.provider)}>
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type EmailIn = {
  available: boolean;
  address: string | null;
  allow: "members" | "anyone";
  membership: boolean;
  recent: { id: string; sender: string; subject: string; files: number; status: string; detail: string; at: number }[];
};

const MSG_STATUS: Record<string, [string, string]> = {
  saved: ["Saved", "badge-good"],
  partial: ["Partly saved", "badge-warn"],
  failed: ["Not saved", "badge-bad"],
  rejected: ["Rejected", "badge-muted"],
};

function EmailInCard({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  const toast = useToast();
  const [s, setS] = useState<EmailIn | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = info.role === "owner" || info.role === "admin";
  useEffect(() => {
    api<EmailIn>(`/api/workspaces/${wid}/email-in`).then(setS, (e) => toast(errMsg(e), "error"));
  }, [wid, toast]);
  const act = async (json: Record<string, unknown>, done?: string) => {
    setBusy(true);
    try {
      setS(await api<EmailIn>(`/api/workspaces/${wid}/email-in`, { method: "POST", json }));
      if (done) toast(done, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="int-card">
      <div className="int-head">
        <span className="int-logo" style={{ background: "var(--amber)" }} aria-hidden>
          <I.mail size={18} />
        </span>
        <div className="grow">
          <b>Email to pdftek</b>
          <div className="small muted">Your workspace&apos;s own email address. Forward bank statements, invoices and receipts to it and the attachments land in your library, ready to convert. Emails without attachments are saved as a document.</div>
        </div>
        {s?.address && <span className="badge badge-good">On</span>}
      </div>
      {!s ? (
        <span className="spinner" />
      ) : !s.available ? (
        <p className="small muted" style={{ margin: 0 }}>Email in isn&apos;t set up on this server yet.</p>
      ) : !s.address ? (
        admin ? (
          <div className="int-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => void act({ action: "enable" }, "Your email address is ready")}>
              {busy ? <span className="spinner" /> : <I.mail size={14} />} Create my address
            </button>
            {!s.membership && <span className="tiny faint" style={{ alignSelf: "center" }}>Included with Day Pass, Pro and Team.</span>}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Ask a workspace owner or admin to turn this on.</p>
        )
      ) : (
        <>
          <div className="es-linkbox">
            <span className="mono small ellipsis">{s.address}</span>
            <button className="btn btn-sm btn-primary" onClick={() => navigator.clipboard.writeText(s.address!).then(() => toast("Address copied"))}>
              <I.copy size={12} /> Copy
            </button>
          </div>
          <div className="field">
            <label htmlFor="ein-allow">Who can send to it</label>
            <select id="ein-allow" className="select" value={s.allow} disabled={!admin || busy} onChange={(e) => void act({ action: "allow", allow: e.target.value }, "Saved")}>
              <option value="members">Only people in this workspace (from their account email)</option>
              <option value="anyone">Anyone who has the address (clients, suppliers, your bank)</option>
            </select>
          </div>
          {admin && (
            <div className="int-actions">
              <button className="btn btn-sm" disabled={busy} onClick={() => confirm("Get a new address? The current one stops working immediately.") && void act({ action: "regenerate" }, "New address ready")}>
                New address
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => confirm("Turn off email in? The address stops working.") && void act({ action: "disable" }, "Email in turned off")}>
                Turn off
              </button>
            </div>
          )}
          {s.recent.length > 0 && (
            <div className="col gap-4">
              <span className="eyebrow">Recent emails</span>
              {s.recent.map((m) => (
                <div key={m.id} className="ein-row">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="small ellipsis" style={{ display: "block" }}>{m.subject || "(no subject)"}</span>
                    <span className="tiny faint ellipsis" style={{ display: "block" }}>
                      {m.sender} · {new Date(m.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {m.files ? ` · ${m.files} file${m.files === 1 ? "" : "s"}` : ""}
                      {m.detail ? ` · ${m.detail}` : ""}
                    </span>
                  </span>
                  <span className={`badge ${(MSG_STATUS[m.status] ?? ["", "badge-muted"])[1]}`}>{(MSG_STATUS[m.status] ?? [m.status])[0]}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
