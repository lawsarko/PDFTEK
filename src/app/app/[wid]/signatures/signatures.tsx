"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CloudButton } from "@/components/cloud";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { Menu, Modal } from "@/components/modal";
import { notifyPaywall } from "@/components/paywall";
import { useToast } from "@/components/toast";

type Role = { key: string; label: string; name?: string; email?: string };
type Template = { id: string; name: string; title: string; message: string; sequential: boolean; documentId: string; documentName: string; pageCount: number; roles: Role[]; sent: number; activeLinks: number; updatedAt: number };
type Signer = { id: string; name: string; email: string; status: string; signedAt: number | null; viewedAt: number | null; link: string; auth: string; payment: { status: string; cents: number; currency: string } | null };
type Envelope = { id: string; title: string; status: string; documentId: string; documentName: string; sender: string; createdAt: number; completedAt: number | null; templateId: string | null; linkId: string | null; batchId: string | null; signers: Signer[] };
type SignLink = {
  id: string;
  title: string;
  url: string;
  templateId: string;
  templateName: string;
  roleLabel: string;
  verifyEmail: boolean;
  payment: { cents: number; currency: string; desc: string } | null;
  maxUses: number | null;
  uses: number;
  signed: number;
  paid: number;
  paidCents: number;
  expiresAt: number | null;
  active: boolean;
  closed: string | null;
  createdAt: number;
};
type Payments = { available: boolean; accountId: string | null; ready: boolean };
type Tab = "envelopes" | "templates" | "links";

const money = (cents: number, currency = "usd") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};
const ENV_STATUS: Record<string, [string, string]> = {
  sent: ["Waiting", "badge-warn"],
  completed: ["Completed", "badge-good"],
  declined: ["Declined", "badge-bad"],
  cancelled: ["Cancelled", "badge-muted"],
};
const SIGNER_STATUS: Record<string, string> = { pending: "not opened", viewed: "opened", signed: "signed", declined: "declined" };
const CURRENCIES = ["usd", "eur", "gbp", "cad", "aud", "ngn", "zar", "kes", "ghs", "inr", "mxn", "brl"];

export function Signatures({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const tab = (["envelopes", "templates", "links"].includes(params.get("tab") ?? "") ? params.get("tab") : "envelopes") as Tab;
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [envelopes, setEnvelopes] = useState<Envelope[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [links, setLinks] = useState<SignLink[] | null>(null);
  const [payments, setPayments] = useState<Payments | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState<Template | null>(null);
  const [bulk, setBulk] = useState<Template | null>(null);
  const [linkFor, setLinkFor] = useState<Template | "pick" | null>(null);
  const [created, setCreated] = useState<SignLink | null>(null);
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [query, setQuery] = useState("");
  const highlight = params.get("id");

  const load = useCallback(async () => {
    const [e, t, l] = await Promise.all([
      api<{ requests: Envelope[] }>(`/api/workspaces/${wid}/signatures`),
      api<{ templates: Template[] }>(`/api/workspaces/${wid}/sign-templates`),
      api<{ links: SignLink[]; payments: Payments }>(`/api/workspaces/${wid}/sign-links`),
    ]);
    setEnvelopes(e.requests);
    setTemplates(t.templates);
    setLinks(l.links);
    setPayments(l.payments);
  }, [wid]);

  useEffect(() => {
    api<WorkspaceInfo>(`/api/workspaces/${wid}`).then(setInfo).catch(() => {});
    void load().catch((e) => toast(errMsg(e), "error"));
  }, [wid, load, toast]);

  const member = info?.billing.membership ?? true;
  const gate = (what: string, fn: () => void) => {
    if (!member) return notifyPaywall({ code: "membership_required", message: `${what} need a Day Pass, Pro or Team.` });
    fn();
  };
  const setTab = (t: Tab) => router.replace(`/app/${wid}/signatures?tab=${t}`, { scroll: false });

  const shownEnvelopes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (envelopes ?? []).filter((e) => {
      if (filter === "open" && e.status !== "sent") return false;
      if (filter === "done" && e.status === "sent") return false;
      if (!q) return true;
      return `${e.title} ${e.documentName} ${e.signers.map((s) => `${s.name} ${s.email}`).join(" ")}`.toLowerCase().includes(q);
    });
  }, [envelopes, filter, query]);

  const envAction = async (e: Envelope, action: "remind" | "cancel") => {
    try {
      const r = await api<{ reminded?: number; delivered?: number }>(`/api/signatures/${e.id}`, { method: "POST", json: { action } });
      toast(action === "cancel" ? "Envelope cancelled" : r.delivered ? `Reminder sent` : "Reminder not emailed: email isn't set up. Copy the signer's link instead.", action === "remind" && !r.delivered ? "error" : "success");
      void load();
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };
  const linkAction = async (l: SignLink, patch: { active?: boolean } | "delete") => {
    try {
      if (patch === "delete") await api(`/api/sign-links/${l.id}`, { method: "DELETE" });
      else await api(`/api/sign-links/${l.id}`, { method: "PATCH", json: patch });
      toast(patch === "delete" ? "Signing link deleted" : patch.active ? "Signing link turned on" : "Signing link turned off", "success");
      void load();
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };
  const deleteTemplate = async (t: Template) => {
    if (!confirm(`Delete the template “${t.name}”? Its signing links stop working. Envelopes already sent and signed copies are kept.`)) return;
    try {
      await api(`/api/sign-templates/${t.id}`, { method: "DELETE" });
      toast("Template deleted", "success");
      void load();
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };
  const copy = (text: string, what = "Link copied") => navigator.clipboard.writeText(text).then(() => toast(what, "success"));

  const counts = { envelopes: envelopes?.length ?? 0, templates: templates?.length ?? 0, links: links?.length ?? 0 };
  const waiting = (envelopes ?? []).filter((e) => e.status === "sent").length;

  return (
    <AppShell wid={wid} title="E-signatures">
      <div className="es-page">
        <div className="es-head">
          <div>
            <h1>E-signatures</h1>
            <p className="small muted">Reusable templates, bulk sends and public signing links, with every envelope in one place.</p>
          </div>
          <div className="es-actions">
            <button className="btn" onClick={() => gate("Templates", () => setPicking(true))}>
              <I.plus size={14} /> New template
            </button>
            <button className="btn" onClick={() => gate("Signing links", () => setLinkFor("pick"))} disabled={!templates?.length} title={templates?.length ? undefined : "Create a template first"}>
              <I.link size={14} /> New signing link
            </button>
            <button
              className="btn btn-primary"
              onClick={() =>
                gate("Templates", () => {
                  if (templates?.length === 1) setSending(templates[0]);
                  else {
                    setTab("templates");
                    toast("Choose the template to send", "info");
                  }
                })
              }
              disabled={!templates?.length}
              title={templates?.length ? undefined : "Create a template first"}
            >
              <I.sign size={14} /> Send from a template
            </button>
          </div>
        </div>

        <div className="fx-tabs es-tabs" role="tablist">
          {(
            [
              ["envelopes", "Envelopes", counts.envelopes],
              ["templates", "Templates", counts.templates],
              ["links", "Signing links", counts.links],
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`fx-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
              {label} <span className="faint">{n}</span>
            </button>
          ))}
        </div>

        {envelopes === null ? (
          <div className="empty">
            <span className="spinner spinner-lg" />
          </div>
        ) : tab === "envelopes" ? (
          <>
            <div className="es-toolbar">
              <div className="es-filters" role="group" aria-label="Filter">
                {(
                  [
                    ["open", `Waiting (${waiting})`],
                    ["done", "Finished"],
                    ["all", "All"],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} className={`chip ${filter === k ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setFilter(k)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="tr-search es-search">
                <I.search size={14} />
                <input className="input input-sm" placeholder="Search by title, document or signer" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search envelopes" />
              </div>
            </div>
            {shownEnvelopes.length === 0 ? (
              <div className="es-empty">
                <I.sign size={26} />
                <b>{envelopes.length ? "Nothing here with this filter" : "No envelopes yet"}</b>
                <p className="small muted">Open a document and choose Fill &amp; sign → Request signatures, or send one from a template.</p>
              </div>
            ) : (
              <div className="es-list">
                {shownEnvelopes.map((e) => (
                  <EnvelopeRow key={e.id} e={e} wid={wid} onRemind={() => void envAction(e, "remind")} onCancel={() => confirm("Cancel this envelope? Signers can no longer sign it.") && void envAction(e, "cancel")} onCopy={(l) => copy(l, "Signing link copied")} />
                ))}
              </div>
            )}
          </>
        ) : tab === "templates" ? (
          templates!.length === 0 ? (
            <div className="es-empty es-empty-lg">
              <I.layers size={28} />
              <b>Set it up once, send it forever</b>
              <p className="small muted">A template keeps a document with its signer roles and fields. Then send it in a few clicks, bulk send it to a whole list from a spreadsheet, or share a public link anyone can sign, and even pay through.</p>
              <ol className="es-steps small">
                <li>Pick a document from your library</li>
                <li>Name the roles (for example Client) and place their fields</li>
                <li>Send it, bulk send it, or share a signing link</li>
              </ol>
              <button className="btn btn-primary" onClick={() => gate("Templates", () => setPicking(true))}>
                <I.plus size={14} /> Create your first template
              </button>
            </div>
          ) : (
            <div className="es-grid">
              {templates!.map((t) => (
                <TemplateCard
                  key={t.id}
                  t={t}
                  highlight={highlight === t.id}
                  onSend={() => gate("Templates", () => setSending(t))}
                  onBulk={() => gate("Bulk send", () => setBulk(t))}
                  onLink={() => gate("Signing links", () => setLinkFor(t))}
                  onEdit={() => router.push(`/app/${wid}/send/${t.documentId}?template=${t.id}`)}
                  onDelete={() => void deleteTemplate(t)}
                />
              ))}
            </div>
          )
        ) : (
          <>
            {payments?.available && !payments.ready && (
              <div className="es-banner">
                <I.bolt size={16} />
                <span className="grow small">
                  <b>Get paid when they sign.</b> Connect Stripe to collect deposits, fees or payments through your signing links. Money goes straight to your own Stripe account.
                </span>
                <Link className="btn btn-sm" href={`/app/${wid}/settings?tab=integrations`}>
                  Connect Stripe
                </Link>
              </div>
            )}
            {links!.length === 0 ? (
              <div className="es-empty es-empty-lg">
                <I.link size={28} />
                <b>One link anyone can sign</b>
                <p className="small muted">Post it on your website, in an email or a QR code: waivers, consent forms, NDAs, rental applications. Each person signs their own copy, confirmed by a code sent to their email, and you get every signed PDF.</p>
                <button className="btn btn-primary" disabled={!templates?.length} onClick={() => gate("Signing links", () => setLinkFor("pick"))}>
                  <I.link size={14} /> {templates?.length ? "Create a signing link" : "Create a template first"}
                </button>
              </div>
            ) : (
              <div className="es-list">
                {links!.map((l) => (
                  <div key={l.id} className={`es-row ${l.active ? "" : "off"}`}>
                    <div className="es-row-main">
                      <div className="row wrap" style={{ gap: 6 }}>
                        <b className="ellipsis">{l.title}</b>
                        {l.closed ? <span className="badge badge-muted">{l.active ? "Closed" : "Off"}</span> : <span className="badge badge-good">Live</span>}
                        {l.payment && <span className="badge badge-info">{money(l.payment.cents, l.payment.currency)}</span>}
                      </div>
                      <div className="tiny muted ellipsis">
                        {l.templateName} · signs as {l.roleLabel} · {l.verifyEmail ? "email confirmed by code" : "no email check"}
                        {l.expiresAt ? ` · until ${new Date(l.expiresAt).toLocaleDateString()}` : ""}
                      </div>
                      <div className="es-stats tiny">
                        <span>
                          <b>{l.signed}</b> signed
                        </span>
                        <span>
                          <b>{l.uses}</b>
                          {l.maxUses ? ` of ${l.maxUses}` : ""} started
                        </span>
                        {l.payment && (
                          <span>
                            <b>{money(l.paidCents, l.payment.currency)}</b> collected ({l.paid})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="es-row-actions">
                      <button className="btn btn-sm" onClick={() => copy(l.url)}>
                        <I.copy size={12} /> Copy link
                      </button>
                      <a className="btn btn-sm btn-ghost" href={l.url} target="_blank" rel="noopener">
                        Open
                      </a>
                      <RowMenu
                        items={[
                          { label: l.active ? "Turn off" : "Turn on", onClick: () => void linkAction(l, { active: !l.active }) },
                          { label: "Delete", danger: true, onClick: () => confirm("Delete this signing link? It stops working. Signed copies are kept.") && void linkAction(l, "delete") },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {picking && <PickDocModal wid={wid} onClose={() => setPicking(false)} onPick={(d) => router.push(`/app/${wid}/send/${d.id}?mode=template`)} />}
      {sending && <SendTemplateModal t={sending} onClose={() => setSending(null)} onSent={() => { setSending(null); void load(); setTab("envelopes"); }} />}
      {bulk && <BulkSendModal t={bulk} onClose={() => setBulk(null)} onSent={() => { void load(); }} />}
      {linkFor && (
        <LinkModal
          wid={wid}
          templates={templates ?? []}
          initial={linkFor === "pick" ? null : linkFor}
          payments={payments}
          onClose={() => setLinkFor(null)}
          onCreated={(l) => {
            setLinkFor(null);
            setCreated(l);
            void load();
            setTab("links");
          }}
        />
      )}
      {created && (
        <Modal title="Your signing link is live" onClose={() => setCreated(null)} footer={<button className="btn btn-primary" onClick={() => setCreated(null)}>Done</button>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Share it anywhere: your website, an email, a message or a QR code. Each person signs their own copy{created.verifyEmail ? " after confirming their email with a code" : ""}, and the signed PDFs arrive in your library.
          </p>
          <div className="es-linkbox">
            <span className="mono small ellipsis">{created.url}</span>
            <button className="btn btn-sm btn-primary" onClick={() => copy(created.url)}>
              <I.copy size={12} /> Copy
            </button>
          </div>
          <div className="row gap-8 mt-12">
            <a className="btn btn-sm" href={created.url} target="_blank" rel="noopener">
              Preview as a signer
            </a>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function RowMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-haspopup="menu">
        <I.more size={16} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        {items.map((it) => (
          <button
            key={it.label}
            className="menu-item"
            style={it.danger ? { color: "var(--bad)" } : undefined}
            onClick={() => {
              setOpen(false);
              it.onClick();
            }}
          >
            {it.label}
          </button>
        ))}
      </Menu>
    </div>
  );
}

function EnvelopeRow({ e, wid, onRemind, onCancel, onCopy }: { e: Envelope; wid: string; onRemind: () => void; onCancel: () => void; onCopy: (link: string) => void }) {
  const [st, cls] = ENV_STATUS[e.status] ?? [e.status, "badge-muted"];
  const signed = e.signers.filter((s) => s.status === "signed").length;
  return (
    <div className="es-row">
      <div className="es-row-main">
        <div className="row wrap" style={{ gap: 6 }}>
          <b className="ellipsis">{e.title}</b>
          <span className={`badge ${cls}`}>{st}</span>
          {e.linkId && <span className="badge badge-muted">Signing link</span>}
          {e.batchId && <span className="badge badge-muted">Bulk send</span>}
          {!e.linkId && !e.batchId && e.templateId && <span className="badge badge-muted">Template</span>}
        </div>
        <div className="tiny muted ellipsis">
          {e.documentName} · {signed}/{e.signers.length} signed · {e.completedAt ? `completed ${timeAgo(e.completedAt)}` : `sent ${timeAgo(e.createdAt)}`}
        </div>
        <div className="es-signers">
          {e.signers.map((s) => (
            <span key={s.id} className={`es-signer ${s.status}`} title={s.email}>
              {s.status === "signed" ? <I.check size={11} /> : <span className="dot" />}
              {s.name}
              <span className="faint">{SIGNER_STATUS[s.status] ?? s.status}</span>
              {s.payment && <span className={`badge ${s.payment.status === "paid" ? "badge-good" : "badge-warn"}`}>{s.payment.status === "paid" ? `Paid ${money(s.payment.cents, s.payment.currency)}` : `${money(s.payment.cents, s.payment.currency)} due`}</span>}
              {e.status === "sent" && s.status !== "signed" && (
                <button className="es-copy" onClick={() => onCopy(s.link)} aria-label={`Copy ${s.name}'s signing link`} title="Copy their signing link">
                  <I.copy size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="es-row-actions">
        <Link className="btn btn-sm" href={`/app/${wid}?doc=${e.documentId}`}>
          Open document
        </Link>
        {e.status === "sent" && (
          <RowMenu
            items={[
              { label: "Send a reminder", onClick: onRemind },
              { label: "Cancel envelope", danger: true, onClick: onCancel },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function TemplateCard({ t, highlight, onSend, onBulk, onLink, onEdit, onDelete }: { t: Template; highlight: boolean; onSend: () => void; onBulk: () => void; onLink: () => void; onEdit: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  return (
    <div ref={ref} className={`es-card ${highlight ? "on" : ""}`}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: "block" }}>{t.name}</b>
          <div className="tiny muted ellipsis">
            <I.file size={11} /> {t.documentName} · {t.pageCount} p
          </div>
        </div>
        <RowMenu
          items={[
            { label: "Edit fields and roles", onClick: onEdit },
            { label: "Delete template", danger: true, onClick: onDelete },
          ]}
        />
      </div>
      <div className="es-roles">
        {t.roles.map((r) => (
          <span key={r.key} className="chip">
            {r.label}
            {r.name ? ` · ${r.name}` : ""}
          </span>
        ))}
        {t.sequential && <span className="chip">In order</span>}
      </div>
      <div className="tiny faint">
        Sent {t.sent} time{t.sent === 1 ? "" : "s"} · {t.activeLinks} live link{t.activeLinks === 1 ? "" : "s"} · updated {timeAgo(t.updatedAt)}
      </div>
      <div className="es-card-actions">
        <button className="btn btn-sm btn-primary" onClick={onSend}>
          <I.sign size={12} /> Send
        </button>
        <button className="btn btn-sm" onClick={onBulk}>
          <I.users size={12} /> Bulk send
        </button>
        <button className="btn btn-sm" onClick={onLink}>
          <I.link size={12} /> Signing link
        </button>
      </div>
    </div>
  );
}

function PickDocModal({ wid, onClose, onPick }: { wid: string; onClose: () => void; onPick: (d: Doc) => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`).then((r) => setDocs(r.documents)).catch(() => setDocs([]));
  }, [wid]);
  const shown = (docs ?? []).filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal title="Choose the document for your template" onClose={onClose}>
      <div className="col gap-12">
        <div className="tr-search">
          <I.search size={14} />
          <input className="input" placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" autoFocus />
        </div>
        <div className="col gap-4" style={{ maxHeight: 360, overflowY: "auto" }}>
          {docs === null && <span className="spinner" />}
          {docs?.length === 0 && (
            <p className="small muted">
              Your library is empty. <Link href={`/app/${wid}`}>Upload a document</Link> first, then come back to make it a template.
            </p>
          )}
          {shown.map((d) => (
            <button key={d.id} className="menu-item" style={{ border: "1px solid var(--line)" }} onClick={() => onPick(d)}>
              <I.file size={14} />
              <span className="grow ellipsis">{d.name}</span>
              <span className="tiny faint mono">{d.pageCount} p</span>
              <I.right size={12} />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

type Person = { name: string; email: string };
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function PeopleFields({ roles, people, setPeople, skip }: { roles: Role[]; people: Record<string, Person>; setPeople: (p: Record<string, Person>) => void; skip?: string }) {
  return (
    <>
      {roles
        .filter((r) => r.key !== skip)
        .map((r) => (
          <fieldset key={r.key} className="es-person">
            <legend>{r.label}</legend>
            <input className="input" placeholder="Full name" aria-label={`${r.label}: full name`} value={people[r.key]?.name ?? ""} onChange={(e) => setPeople({ ...people, [r.key]: { ...(people[r.key] ?? { email: "" }), name: e.target.value } })} />
            <input className="input" type="email" placeholder="email@example.com" aria-label={`${r.label}: email`} value={people[r.key]?.email ?? ""} onChange={(e) => setPeople({ ...people, [r.key]: { ...(people[r.key] ?? { name: "" }), email: e.target.value } })} />
          </fieldset>
        ))}
    </>
  );
}

const defaults = (roles: Role[]) => Object.fromEntries(roles.map((r) => [r.key, { name: r.name ?? "", email: r.email ?? "" }]));

function SendTemplateModal({ t, onClose, onSent }: { t: Template; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Record<string, Person>>(() => defaults(t.roles));
  const [title, setTitle] = useState(t.title);
  const [message, setMessage] = useState(t.message);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ name: string; link: string }[] | null>(null);
  const ok = title.trim() && t.roles.every((r) => people[r.key]?.name.trim() && validEmail(people[r.key]?.email ?? ""));
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ delivered: number; links: { name: string; link: string }[] }>(`/api/sign-templates/${t.id}/send`, { method: "POST", json: { mode: "single", people, title, message } });
      if (r.delivered) {
        toast(`Sent for signature`, "success");
        onSent();
      } else setLinks(r.links.map((l) => ({ ...l, link: `${location.origin}${l.link}` })));
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };
  if (links)
    return (
      <Modal title="Envelope created" onClose={onSent} footer={<button className="btn btn-primary" onClick={onSent}>Done</button>}>
        <p className="small muted" style={{ marginTop: 0 }}>Email isn&apos;t set up on this server, so share each signer&apos;s private link yourself:</p>
        {links.map((l) => (
          <div key={l.link} className="list-item">
            <span className="grow">{l.name}</span>
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(l.link).then(() => toast("Link copied"))}>
              <I.copy size={12} /> Copy link
            </button>
          </div>
        ))}
      </Modal>
    );
  return (
    <Modal
      title={`Send “${t.name}”`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ok || busy} onClick={() => void send()}>
            {busy ? <span className="spinner" /> : <I.sign size={14} />} Send for signature
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <PeopleFields roles={t.roles} people={people} setPeople={setPeople} />
        <div className="field">
          <label htmlFor="st-title">Envelope title</label>
          <input id="st-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="st-msg">Message (optional)</label>
          <textarea id="st-msg" className="textarea" style={{ minHeight: 56 }} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Each signer gets an email with a secure link{t.sequential ? ", one at a time in order" : ""}. Fields are placed exactly as in the template.</p>
      </div>
    </Modal>
  );
}

/** Reads "name, email" rows from a CSV file or pasted text (with or without a header row). */
function parseRows(text: string): { rows: Person[]; bad: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (!q && (ch === "," || ch === ";" || ch === "\t")) (out.push(cur.trim()), (cur = ""));
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  let nameCol = -1;
  let emailCol = -1;
  let first = -1;
  let last = -1;
  let start = 0;
  const head = lines[0] ? split(lines[0]).map((h) => h.toLowerCase()) : [];
  if (head.some((h) => h.includes("mail"))) {
    emailCol = head.findIndex((h) => h.includes("mail"));
    nameCol = head.findIndex((h) => h === "name" || h === "full name" || h === "nombre");
    first = head.findIndex((h) => h.includes("first"));
    last = head.findIndex((h) => h.includes("last") || h.includes("surname"));
    start = 1;
  }
  const rows: Person[] = [];
  let bad = 0;
  for (const l of lines.slice(start)) {
    const c = split(l);
    // A row may hold just an email (even under a "name,email" header): use whichever cell has the @.
    const email = (emailCol >= 0 && c[emailCol]?.includes("@") ? c[emailCol] : c.find((x) => x.includes("@"))) ?? "";
    let name = nameCol >= 0 ? (c[nameCol] ?? "") : first >= 0 ? [c[first], last >= 0 ? c[last] : ""].join(" ").trim() : (c.find((x) => !x.includes("@")) ?? "");
    if (name.includes("@")) name = "";
    if (!name && email) name = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    if (validEmail(email) && name) rows.push({ name, email: email.toLowerCase() });
    else bad++;
  }
  return { rows, bad };
}

function BulkSendModal({ t, onClose, onSent }: { t: Template; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const wid = (useParams() as { wid?: string }).wid;
  const fileRef = useRef<HTMLInputElement>(null);
  const [roleKey, setRoleKey] = useState(() => (t.roles.find((r) => !r.email) ?? t.roles[0]).key);
  const [others, setOthers] = useState<Record<string, Person>>(() => defaults(t.roles));
  const [text, setText] = useState("");
  const [title, setTitle] = useState(t.title);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sent: number; delivered: number; skipped: number; failed: { email: string; error: string }[] } | null>(null);
  const parsed = useMemo(() => parseRows(text), [text]);
  const role = t.roles.find((r) => r.key === roleKey)!;
  const othersOk = t.roles.filter((r) => r.key !== roleKey).every((r) => others[r.key]?.name.trim() && validEmail(others[r.key]?.email ?? ""));
  const ok = parsed.rows.length > 0 && othersOk && title.trim();

  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: number; delivered: number; skipped: number; failed: { email: string; error: string }[] }>(`/api/sign-templates/${t.id}/send`, {
        method: "POST",
        json: { mode: "bulk", roleKey, rows: parsed.rows, others: Object.fromEntries(Object.entries(others).filter(([k]) => k !== roleKey)), title },
      });
      setDone(r);
      onSent();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Modal title="Bulk send finished" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <div className="tr-done">
          <span className="tr-done-ico">
            <I.check size={20} />
          </span>
          <div>
            <b>
              {done.sent} envelope{done.sent === 1 ? "" : "s"} sent
            </b>
            <div className="small muted">
              {done.delivered ? `${done.delivered} invitation email${done.delivered === 1 ? "" : "s"} delivered. ` : "Email isn't set up on this server: copy signing links from the Envelopes tab. "}
              {done.skipped ? `${done.skipped} duplicate address${done.skipped === 1 ? "" : "es"} skipped.` : ""}
            </div>
          </div>
        </div>
        {done.failed.length > 0 && (
          <div className="notice notice-bad mt-12">
            {done.failed.length} couldn&apos;t be sent: {done.failed.slice(0, 5).map((f) => `${f.email} (${f.error})`).join(", ")}
          </div>
        )}
      </Modal>
    );

  return (
    <Modal
      title={`Bulk send “${t.name}”`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ok || busy} onClick={() => void send()}>
            {busy ? <span className="spinner" /> : <I.users size={14} />} {busy ? "Sending…" : `Send ${parsed.rows.length || ""} envelope${parsed.rows.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p className="small muted" style={{ margin: 0 }}>Everyone on your list gets their own copy to sign, with their own link and reminders. Upload a spreadsheet saved as CSV, or paste names and emails.</p>
        {t.roles.length > 1 && (
          <div className="field">
            <label htmlFor="bk-role">The list fills the role</label>
            <select id="bk-role" className="select" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
              {t.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <div className="row between">
            <label htmlFor="bk-rows">People who sign as {role.label}</label>
            <span className="row gap-6 wrap">
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <I.upload size={12} /> Upload CSV
              </button>
              {wid && <CloudButton wid={wid} kind="csv" multiple={false} reopenKey="bulksend" onFiles={async (f) => f[0] && setText(await f[0].text())} />}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
              e.target.value = "";
            }}
          />
          <textarea id="bk-rows" className="textarea mono" style={{ minHeight: 120, fontSize: 12.5 }} placeholder={"name,email\nAna García,ana@example.com\nJohn Okafor,john@example.com"} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="tiny faint">
            {parsed.rows.length ? `${parsed.rows.length} ${parsed.rows.length === 1 ? "person" : "people"} ready` : "One person per line: name and email, separated by a comma."}
            {parsed.bad ? ` · ${parsed.bad} line${parsed.bad === 1 ? "" : "s"} skipped (no valid email)` : ""}
          </span>
        </div>
        {parsed.rows.length > 0 && (
          <div className="es-preview">
            {parsed.rows.slice(0, 4).map((r) => (
              <div key={r.email} className="row small">
                <span className="grow ellipsis">{r.name}</span>
                <span className="muted ellipsis">{r.email}</span>
              </div>
            ))}
            {parsed.rows.length > 4 && <div className="tiny faint">and {parsed.rows.length - 4} more</div>}
          </div>
        )}
        <PeopleFields roles={t.roles} people={others} setPeople={setOthers} skip={roleKey} />
        <div className="field">
          <label htmlFor="bk-title">Envelope title</label>
          <input id="bk-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <span className="tiny faint">Each envelope is titled “{title || t.title} — name”.</span>
        </div>
      </div>
    </Modal>
  );
}

function LinkModal({ wid, templates, initial, payments, onClose, onCreated }: { wid: string; templates: Template[]; initial: Template | null; payments: Payments | null; onClose: () => void; onCreated: (l: SignLink) => void }) {
  const toast = useToast();
  const [tid, setTid] = useState(initial?.id ?? templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === tid) ?? null;
  const [title, setTitle] = useState(initial?.title ?? templates[0]?.title ?? "");
  const [roleKey, setRoleKey] = useState(() => (t ? (t.roles.find((r) => !r.email) ?? t.roles[0]).key : ""));
  const [others, setOthers] = useState<Record<string, Person>>(() => (t ? defaults(t.roles) : {}));
  const [verify, setVerify] = useState(true);
  const [charge, setCharge] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [desc, setDesc] = useState("");
  const [limit, setLimit] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (id: string) => {
    const n = templates.find((x) => x.id === id);
    setTid(id);
    if (n) {
      setTitle(n.title);
      setRoleKey((n.roles.find((r) => !r.email) ?? n.roles[0]).key);
      setOthers(defaults(n.roles));
    }
  };
  const othersOk = t ? t.roles.filter((r) => r.key !== roleKey).every((r) => others[r.key]?.name.trim() && validEmail(others[r.key]?.email ?? "")) : false;
  const amountOk = !charge || Number(amount) >= 0.5;
  const ok = t && title.trim() && othersOk && amountOk;
  const canPay = payments?.available && payments.ready;

  const create = async () => {
    if (!t) return;
    setBusy(true);
    try {
      const r = await api<{ link: SignLink }>(`/api/workspaces/${wid}/sign-links`, {
        method: "POST",
        json: {
          templateId: t.id,
          title,
          roleKey,
          others: Object.fromEntries(Object.entries(others).filter(([k]) => k !== roleKey)),
          verifyEmail: verify,
          payment: charge ? { amount: Number(amount), currency, description: desc } : null,
          maxUses: limit ? Number(limit) : null,
          expiresAt: until ? new Date(`${until}T23:59:59`).getTime() : null,
        },
      });
      onCreated(r.link);
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New signing link"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ok || busy} onClick={() => void create()}>
            {busy ? <span className="spinner" /> : <I.link size={14} />} Create link
          </button>
        </>
      }
    >
      <div className="col gap-12">
        {!initial && (
          <div className="field">
            <label htmlFor="lk-tpl">Template</label>
            <select id="lk-tpl" className="select" value={tid} onChange={(e) => pick(e.target.value)}>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="lk-title">Link title</label>
          <input id="lk-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Liability waiver" />
          <span className="tiny faint">People see this when they open the link.</span>
        </div>
        {t && t.roles.length > 1 && (
          <>
            <div className="field">
              <label htmlFor="lk-role">People who open the link sign as</label>
              <select id="lk-role" className="select" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
                {t.roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="tiny faint" style={{ margin: 0 }}>The other roles countersign after each person, by email:</p>
            <PeopleFields roles={t.roles} people={others} setPeople={setOthers} skip={roleKey} />
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
          <span>
            Confirm each signer&apos;s email with a one-time code <span className="tiny faint">(recommended: it&apos;s recorded on the certificate)</span>
          </span>
        </label>

        <div className={`es-pay ${charge ? "on" : ""}`}>
          <label className="check">
            <input type="checkbox" checked={charge} disabled={!canPay} onChange={(e) => setCharge(e.target.checked)} />
            <span>
              <b>Collect a payment</b> <span className="tiny faint">after they sign: deposits, fees, registrations</span>
            </span>
          </label>
          {!canPay && (
            <p className="tiny muted" style={{ margin: "6px 0 0 24px" }}>
              {payments?.available ? (
                <>
                  <Link href={`/app/${wid}/settings?tab=integrations`}>Connect Stripe</Link> to collect payments. Money goes straight to your own Stripe account.
                </>
              ) : (
                "Payments aren't available on this server."
              )}
            </p>
          )}
          {charge && (
            <div className="es-pay-fields">
              <div className="field">
                <label htmlFor="lk-amount">Amount</label>
                <div className="row gap-6">
                  <select className="select" aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 92 }}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <input id="lk-amount" className="input" inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="lk-desc">What it&apos;s for</label>
                <input id="lk-desc" className="input" placeholder="e.g. Security deposit" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <details className="es-more">
          <summary className="small">Limits (optional)</summary>
          <div className="es-pay-fields mt-8">
            <div className="field">
              <label htmlFor="lk-limit">Stop after this many signers</label>
              <input id="lk-limit" className="input" inputMode="numeric" placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="field">
              <label htmlFor="lk-until">Open until</label>
              <input id="lk-until" className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>
        </details>
      </div>
    </Modal>
  );
}
