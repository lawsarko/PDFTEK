"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errMsg, initials } from "@/lib/client/api";
import type { Member, WorkspaceInfo } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { useToast } from "@/components/toast";
import { CreditPacks, PlanCards } from "@/components/pricing";
import type { Entitlements } from "@/lib/plans";

type Invite = { id: string; email: string; role: string; token: string; created_at: number };
const TABS = [
  ["workspace", "Workspace"],
  ["members", "Members"],
  ["playbook", "Review playbook"],
  ["billing", "Plan & billing"],
  ["profile", "Profile"],
] as const;

export function Settings({ wid }: { wid: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") ?? "workspace";
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setInfo(await api<WorkspaceInfo>(`/api/workspaces/${wid}`));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }, [wid, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (params.get("checkout") === "success") toast("Thanks! Your subscription is active.", "success");
  }, [params, toast]);

  return (
    <AppShell wid={wid} title="Settings">
      <div className="shell">
        <h1>Settings</h1>
        <div className="row settings-layout mt-24" style={{ alignItems: "flex-start", gap: 28 }}>
          <nav className="side-tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={`side-tab ${tab === k ? "active" : ""}`} onClick={() => router.replace(`/app/${wid}/settings?tab=${k}`)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="grow" style={{ maxWidth: 760 }}>
            {!info ? (
              <span className="spinner" />
            ) : tab === "members" ? (
              <Members wid={wid} info={info} />
            ) : tab === "playbook" ? (
              <Playbook wid={wid} info={info} />
            ) : tab === "billing" ? (
              <Billing wid={wid} info={info} reload={load} />
            ) : tab === "profile" ? (
              <Profile info={info} />
            ) : (
              <WorkspaceTab wid={wid} info={info} reload={load} />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function WorkspaceTab({ wid, info, reload }: { wid: string; info: WorkspaceInfo; reload: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(info.workspace.name);
  const canAdmin = info.role !== "member";
  const caps = info.capabilities;
  return (
    <div className="col gap-16">
      <div className="card">
        <h3 style={{ fontSize: 16 }}>Workspace</h3>
        <div className="field mt-12">
          <label>Name</label>
          <div className="row">
            <input className="input" value={name} disabled={!canAdmin} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={!canAdmin || !name.trim() || name === info.workspace.name}
              onClick={async () => {
                try {
                  await api(`/api/workspaces/${wid}`, { method: "PATCH", json: { name } });
                  toast("Saved", "success");
                  void reload();
                } catch (e) {
                  toast(errMsg(e), "error");
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
        <div className="small muted mt-12">
          {info.stats.docs} documents · {info.stats.pages} pages indexed · your role: <b>{info.role}</b>
        </div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 16 }}>Server capabilities</h3>
        <div className="col mt-12 small">
          {[
            [caps.ai, "AI assistant (chat, extraction, automations)", "Set ANTHROPIC_API_KEY on the server to enable."],
            [caps.email, "Outbound email (invites, signatures, requests, digests)", "Set SMTP_URL to send email. Until then, share links manually."],
            [caps.serverOffice, "Word, Excel & PowerPoint → PDF (LibreOffice)", "Deploy with the included Dockerfile (on Render: the render.yaml blueprint), which bundles LibreOffice."],
            [caps.billing, "Online billing (Stripe)", "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to take payments. Prices are built in."],
          ].map(([ok, label, hint]) => (
            <div key={label as string} className="row" style={{ alignItems: "flex-start" }}>
              <span className={`badge ${ok ? "badge-good" : "badge-muted"}`} style={{ minWidth: 34, textAlign: "center" }}>
                {ok ? "on" : "off"}
              </span>
              <div>
                {label}
                {!ok && <div className="tiny faint">{hint}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {info.role === "owner" && (
        <div className="card" style={{ borderColor: "rgba(224,106,92,.4)" }}>
          <h3 style={{ fontSize: 16, color: "var(--bad)" }}>Danger zone</h3>
          <p className="small muted">Deleting a workspace permanently removes its documents, versions, signatures, requests and automations.</p>
          <button
            className="btn btn-danger"
            onClick={async () => {
              const typed = prompt(`Type the workspace name (“${info.workspace.name}”) to delete it permanently.`);
              if (typed !== info.workspace.name) return;
              await api(`/api/workspaces/${wid}`, { method: "DELETE" });
              window.location.href = "/app";
            }}
          >
            <I.trash size={14} /> Delete workspace
          </button>
        </div>
      )}
    </div>
  );
}

function Members({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const canAdmin = info.role !== "member";

  const load = useCallback(async () => {
    const r = await api<{ members: Member[]; invites: Invite[] }>(`/api/workspaces/${wid}/members`);
    setMembers(r.members);
    setInvites(r.invites);
  }, [wid]);
  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    try {
      const r = await api<{ link: string; delivered: boolean }>(`/api/workspaces/${wid}/invites`, { method: "POST", json: { email, role } });
      if (r.delivered) toast(`Invitation emailed to ${email}`, "success");
      else {
        await navigator.clipboard.writeText(r.link).catch(() => {});
        toast("Invite link copied to clipboard (email isn't configured)", "info");
      }
      setEmail("");
      void load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <div className="col gap-16">
      {canAdmin && (
        <div className="card">
          <h3 style={{ fontSize: 16 }}>Invite teammates</h3>
          <div className="row wrap mt-12">
            <input className="input grow" style={{ minWidth: 200 }} type="email" placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && invite()} />
            <select className="select" style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn btn-primary" disabled={!email} onClick={invite}>
              <I.mail size={14} /> Invite
            </button>
          </div>
          <p className="tiny faint mt-8">Admins can invite people, manage roles, edit the playbook and release edit locks. Owners also manage billing.</p>
        </div>
      )}
      <div className="card">
        <h3 style={{ fontSize: 16 }}>Members ({members.length})</h3>
        {members.map((m) => (
          <div key={m.id} className="list-item">
            <span className="avatar">{initials(m.name)}</span>
            <div className="grow">
              {m.name} {m.id === info.me.id && <span className="faint">(you)</span>}
              <div className="small muted">{m.email}</div>
            </div>
            {canAdmin && m.id !== info.me.id ? (
              <select
                className="select input-sm"
                style={{ width: 110 }}
                value={m.role}
                onChange={async (e) => {
                  try {
                    await api(`/api/workspaces/${wid}/members`, { method: "PATCH", json: { userId: m.id, role: e.target.value } });
                    void load();
                  } catch (err) {
                    toast(errMsg(err), "error");
                  }
                }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {info.role === "owner" && <option value="owner">Owner</option>}
              </select>
            ) : (
              <span className="badge badge-muted">{m.role}</span>
            )}
            {(canAdmin || m.id === info.me.id) && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (!confirm(m.id === info.me.id ? "Leave this workspace?" : `Remove ${m.name}?`)) return;
                  try {
                    await api(`/api/workspaces/${wid}/members?userId=${m.id}`, { method: "DELETE" });
                    if (m.id === info.me.id) window.location.href = "/app";
                    else void load();
                  } catch (e) {
                    toast(errMsg(e), "error");
                  }
                }}
              >
                {m.id === info.me.id ? "Leave" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>
      {invites.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 16 }}>Pending invitations</h3>
          {invites.map((i) => (
            <div key={i.id} className="list-item">
              <I.mail size={15} />
              <div className="grow">
                {i.email} <span className="badge badge-muted">{i.role}</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}/invite/${i.token}`).then(() => toast("Link copied"))}>
                <I.link size={12} /> Copy link
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  await api(`/api/workspaces/${wid}/invites?id=${i.id}`, { method: "DELETE" });
                  void load();
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Playbook({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  const toast = useToast();
  const [text, setText] = useState(info.workspace.playbook);
  const canAdmin = info.role !== "member";
  return (
    <div className="card">
      <h3 style={{ fontSize: 16 }}>Review playbook</h3>
      <p className="small muted">
        Your team&apos;s standard positions. pdftek checks <b>Risk flags</b> extractions and “Compare to playbook” questions against this text. Write it in plain language, one rule per line.
      </p>
      <textarea className="textarea mono" style={{ minHeight: 360, fontSize: 12.5 }} value={text} disabled={!canAdmin} onChange={(e) => setText(e.target.value)} />
      <div className="row mt-12" style={{ justifyContent: "flex-end" }}>
        <button
          className="btn btn-primary"
          disabled={!canAdmin || text === info.workspace.playbook}
          onClick={async () => {
            try {
              await api(`/api/workspaces/${wid}`, { method: "PATCH", json: { playbook: text } });
              toast("Playbook saved", "success");
            } catch (e) {
              toast(errMsg(e), "error");
            }
          }}
        >
          Save playbook
        </button>
      </div>
    </div>
  );
}

type BillingData = {
  entitlements: Entitlements;
  hasSubscription: boolean;
  plan: string;
  ledger: { id: string; delta: number; reason: string; created_at: number }[];
  purchases: { id: string; name: string; amount_cents: number; created_at: number }[];
};

function Billing({ wid, info }: { wid: string; info: WorkspaceInfo; reload: () => Promise<void> }) {
  const toast = useToast();
  const [data, setData] = useState<BillingData | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = info.role === "owner";
  useEffect(() => {
    const load = () => api<BillingData>(`/api/workspaces/${wid}/billing`).then(setData).catch((e) => toast(errMsg(e), "error"));
    load();
    window.addEventListener("pdftek:usage", load);
    return () => window.removeEventListener("pdftek:usage", load);
  }, [wid, toast]);
  if (!data) return <div className="empty"><span className="spinner" /></div>;
  const e = data.entitlements;
  const portal = async () => {
    setBusy(true);
    try {
      const r = await api<{ url: string }>(`/api/workspaces/${wid}/billing`, { method: "POST", json: { action: "portal" } });
      window.location.href = r.url;
    } catch (err) {
      toast(errMsg(err), "error");
      setBusy(false);
    }
  };
  const tierName = { guest: "Free (no account)", free: "Free", pass: "Day Pass", pro: "Pro", team: "Team", admin: "Admin" }[e.tier];
  const current = e.tier === "team" ? "team" : e.tier === "pro" ? "pro" : e.tier === "pass" ? "pass" : e.tier === "admin" ? "" : "free";
  return (
    <div className="col gap-16">
      <div className="card">
        <div className="row between wrap" style={{ gap: 12 }}>
          <div>
            <div className="eyebrow">Current plan</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, marginTop: 4 }}>{tierName}</div>
            <div className="small muted mt-8">
              {e.taskLimit !== null
                ? `${e.tasksToday} of ${e.taskLimit} free tasks used today · files up to ${e.maxFileMb} MB`
                : e.passUntil
                  ? `Unlimited tasks until ${new Date(e.passUntil).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                  : "Unlimited tasks · files up to 100 MB"}
            </div>
          </div>
          <div className="credit-balance">
            <div className="eyebrow">AI credits</div>
            <div className="credit-number"><I.sparkle size={16} /> {(e.credits + e.allowance).toLocaleString()}</div>
            <div className="tiny muted">
              {e.allowance ? `${e.allowance.toLocaleString()} monthly (renews ${new Date(e.allowanceExpiresAt!).toLocaleDateString()}) + ` : ""}
              {e.credits.toLocaleString()} purchased
            </div>
          </div>
        </div>
        {data.hasSubscription && owner && (
          <div className="row mt-16">
            <button className="btn" disabled={busy} onClick={portal}>
              {busy && <span className="spinner" />} Manage subscription, card & invoices
            </button>
          </div>
        )}
        {!e.paymentsEnabled && <p className="small muted mt-12">Online payments aren&apos;t configured on this server yet (set STRIPE_SECRET_KEY).</p>}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 16 }}>Plans</h3>
        <div className="mt-12">
          <PlanCards workspaceId={wid} current={current} yearly={false} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 16 }}>Top up AI credits</h3>
        <p className="small muted" style={{ marginTop: 4 }}>For AI questions, summaries and extraction, and for tasks beyond the free daily limit. Credits never expire.</p>
        <div className="mt-12">
          <CreditPacks workspaceId={wid} />
        </div>
      </div>

      {(data.ledger.length > 0 || data.purchases.length > 0) && (
        <div className="card">
          <h3 style={{ fontSize: 16 }}>History</h3>
          <table className="table mt-12">
            <tbody>
              {data.purchases.map((p) => (
                <tr key={p.id}>
                  <td className="small">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td>{p.name}</td>
                  <td className="mono small" style={{ textAlign: "right" }}>${(p.amount_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
              {data.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="small">{new Date(l.created_at).toLocaleDateString()}</td>
                  <td className="small">{l.reason}</td>
                  <td className="mono small" style={{ textAlign: "right", color: l.delta > 0 ? "var(--good)" : undefined }}>
                    {l.delta > 0 ? "+" : ""}
                    {l.delta} credits
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Profile({ info }: { info: WorkspaceInfo }) {
  const toast = useToast();
  const [name, setName] = useState(info.me.name);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  return (
    <div className="col gap-16">
      <div className="card">
        <h3 style={{ fontSize: 16 }}>Profile</h3>
        <div className="field mt-12">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field mt-12">
          <label>Email</label>
          <input className="input" value={info.me.email} disabled />
        </div>
        <button
          className="btn btn-primary mt-12"
          disabled={!name.trim() || name === info.me.name}
          onClick={async () => {
            try {
              await api("/api/me", { method: "PATCH", json: { name } });
              toast("Profile saved", "success");
            } catch (e) {
              toast(errMsg(e), "error");
            }
          }}
        >
          Save
        </button>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 16 }}>Change password</h3>
        <div className="field mt-12">
          <label>Current password</label>
          <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </div>
        <div className="field mt-12">
          <label>New password</label>
          <input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </div>
        <button
          className="btn mt-12"
          disabled={pw.newPassword.length < 8 || !pw.currentPassword}
          onClick={async () => {
            try {
              await api("/api/me", { method: "PATCH", json: pw });
              setPw({ currentPassword: "", newPassword: "" });
              toast("Password updated", "success");
            } catch (e) {
              toast(errMsg(e), "error");
            }
          }}
        >
          Update password
        </button>
      </div>
    </div>
  );
}
