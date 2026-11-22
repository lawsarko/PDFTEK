"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { PdfViewer, type PageInfo } from "@/components/pdf-viewer";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { notifyPaywall } from "@/components/paywall";
import { useToast } from "@/components/toast";

type Kind = "signature" | "initials" | "date" | "name" | "text";
/** A signer (send mode) or a role (template mode: label, with an optional fixed person). */
type Signer = { key: string; name: string; email: string; label?: string; fixed?: boolean };
type Field = { id: string; signerKey: string; page: number; x: number; y: number; w: number; h: number; kind: Kind };
type TemplateDTO = {
  id: string;
  name: string;
  title: string;
  message: string;
  sequential: boolean;
  documentId: string;
  versionId: string;
  roles: { key: string; label: string; name?: string; email?: string }[];
  fields: { roleKey: string; page: number; x: number; y: number; w: number; h: number; kind: Kind }[];
};

const COLORS = ["#d98e2b", "#6ea8e0", "#6fb37a", "#c77dd8", "#e06a5c", "#e0c04a"];
const SIZE: Record<Kind, [number, number]> = { signature: [0.28, 0.06], initials: [0.09, 0.045], date: [0.16, 0.028], name: [0.22, 0.028], text: [0.25, 0.028] };
const KIND_LABEL: Record<Kind, string> = { signature: "Signature", initials: "Initials", date: "Date signed", name: "Full name", text: "Text box" };
const uid = () => Math.random().toString(36).slice(2, 9);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function SendForSignature({ wid, docId, mode = "send", templateId }: { wid: string; docId: string; mode?: "send" | "template"; templateId?: string }) {
  const toast = useToast();
  const router = useRouter();
  const tpl = mode === "template";
  const [doc, setDoc] = useState<Doc | null>(null);
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sequential, setSequential] = useState(false);
  const [signers, setSigners] = useState<Signer[]>([{ key: uid(), name: "", email: "", label: tpl ? "Signer" : undefined }]);
  const [active, setActive] = useState(0);
  const [kind, setKind] = useState<Kind>("signature");
  const [fields, setFields] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ delivered: number; links: { name: string; email: string; link: string }[] } | null>(null);
  const [scale, setScale] = useState(1.2);
  const [step, setStep] = useState<"details" | "fields">("details");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ document: Doc }>(`/api/documents/${docId}`).then((r) => {
      setDoc(r.document);
      if (!templateId) {
        const base = r.document.name.replace(/\.pdf$/i, "");
        setTitle(base);
        setName(base);
        setVersionId(r.document.versionId);
      }
    });
    api<WorkspaceInfo>(`/api/workspaces/${wid}`).then(setInfo);
    if (templateId) {
      api<{ template: TemplateDTO }>(`/api/sign-templates/${templateId}`)
        .then(({ template: t }) => {
          setName(t.name);
          setTitle(t.title);
          setMessage(t.message);
          setSequential(t.sequential);
          setVersionId(t.versionId);
          setSigners(t.roles.map((r) => ({ key: r.key, label: r.label, name: r.name ?? "", email: r.email ?? "", fixed: Boolean(r.name && r.email) })));
          setFields(t.fields.map((f) => ({ id: uid(), signerKey: f.roleKey, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, kind: f.kind })));
        })
        .catch((e) => toast(errMsg(e), "error"));
    }
    const fit = () => setScale(Math.max(0.5, Math.min(1.3, (window.innerWidth - (window.innerWidth > 960 ? 380 : 24)) / 640)));
    fit();
  }, [docId, wid, templateId, toast]);

  const signer = signers[active];
  const color = (key: string) => COLORS[signers.findIndex((s) => s.key === key) % COLORS.length];
  const who = (s: Signer, i: number) => (tpl ? s.label?.trim() || `Role ${i + 1}` : s.name.trim() || `Signer ${i + 1}`);

  const place = (pinfo: PageInfo, e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || !signer) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = SIZE[kind];
    const x = Math.min(1 - w, Math.max(0, (e.clientX - r.left) / pinfo.width - w / 2));
    const y = Math.min(1 - h, Math.max(0, (e.clientY - r.top) / pinfo.height - h / 2));
    setFields((f) => [...f, { id: uid(), signerKey: signer.key, page: pinfo.page, x, y, w, h, kind }]);
  };

  const drag = (e: React.PointerEvent, f: Field, pinfo: PageInfo, resize: boolean) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / pinfo.width;
      const dy = (ev.clientY - sy) / pinfo.height;
      setFields((list) =>
        list.map((x) =>
          x.id !== f.id
            ? x
            : resize
              ? { ...x, w: Math.max(0.03, Math.min(1 - x.x, f.w + dx)), h: Math.max(0.015, Math.min(1 - x.y, f.h + dy)) }
              : { ...x, x: Math.max(0, Math.min(1 - f.w, f.x + dx)), y: Math.max(0, Math.min(1 - f.h, f.y + dy)) },
        ),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ delivered: number; links: { name: string; email: string; link: string }[] }>(`/api/workspaces/${wid}/signatures`, {
        method: "POST",
        json: { documentId: docId, title, message, sequential, signers: signers.map(({ key, name, email }) => ({ key, name, email })), fields: fields.map(({ id: _id, ...f }) => f) },
      });
      setResult(r);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (info && !info.billing.membership) return notifyPaywall({ code: "membership_required", message: "E-signature templates need a Day Pass, Pro or Team." });
    setBusy(true);
    try {
      const payload = {
        name,
        title,
        message,
        sequential,
        roles: signers.map((s) => ({ key: s.key, label: (s.label ?? "").trim(), ...(s.fixed ? { name: s.name.trim(), email: s.email.trim() } : {}) })),
        fields: fields.map(({ signerKey, page, x, y, w, h, kind: k }) => ({ roleKey: signerKey, page, x, y, w, h, kind: k })),
      };
      const r = templateId
        ? await api<{ template: { id: string } }>(`/api/sign-templates/${templateId}`, { method: "PATCH", json: payload })
        : await api<{ template: { id: string } }>(`/api/workspaces/${wid}/sign-templates`, { method: "POST", json: { ...payload, documentId: docId } });
      toast(templateId ? "Template updated" : "Template saved", "success");
      router.push(`/app/${wid}/signatures?tab=templates&id=${r.template.id}`);
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  // What still blocks saving or sending, in plain words, so the button never looks broken.
  const missing: string[] = [];
  if (tpl && !name.trim()) missing.push("Name the template.");
  if (!title.trim()) missing.push(tpl ? "Add a default envelope title." : "Add an envelope title.");
  const labels = new Set<string>();
  signers.forEach((s, i) => {
    const w = who(s, i);
    if (tpl) {
      const l = (s.label ?? "").trim().toLowerCase();
      if (!l) missing.push(`Name role ${i + 1} (for example Client).`);
      else if (labels.has(l)) missing.push(`Two roles are called “${s.label}”. Give each a different name.`);
      labels.add(l);
      if (s.fixed && (!s.name.trim() || !validEmail(s.email))) missing.push(`Enter the name and email of the person who always signs as ${w}.`);
    } else {
      if (!s.name.trim()) missing.push(`Enter a name for Signer ${i + 1}.`);
      if (!validEmail(s.email)) missing.push(`Enter a valid email for ${w}.`);
    }
    if (!fields.some((f) => f.signerKey === s.key && f.kind === "signature")) missing.push(`Place a Signature field for ${w}: select ${tpl ? "the role" : "them"}, choose Signature, then click the document.`);
  });
  const ready = missing.length === 0;

  if (!doc || !info) return <div className="empty"><span className="spinner spinner-lg" /></div>;
  const primary = tpl ? (
    <>{busy ? <span className="spinner" /> : <I.check size={14} />} {templateId ? "Save changes" : "Save template"}</>
  ) : (
    <>{busy ? <span className="spinner" /> : <I.sign size={14} />} Send for signature</>
  );

  return (
    <AppShell
      wid={wid}
      title={`${tpl ? (templateId ? "Edit template" : "New template") : "Request signatures"} · ${doc.name}`}
      actions={
        <button className="btn btn-primary btn-sm hide-mobile" disabled={!ready || busy} onClick={tpl ? saveTemplate : send} title={missing[0]}>
          {primary}
        </button>
      }
    >
      <div className="send-steps show-mobile" role="tablist">
        <button role="tab" aria-selected={step === "details"} className={step === "details" ? "on" : ""} onClick={() => setStep("details")}>
          1 · {tpl ? "Roles" : "Signers"}
        </button>
        <button role="tab" aria-selected={step === "fields"} className={step === "fields" ? "on" : ""} onClick={() => setStep("fields")}>
          2 · Place fields <span className="faint">{fields.length}</span>
        </button>
      </div>
      <div className="main send-main" data-view={step === "details" ? "library" : "document"}>
        <aside className="rail send-rail">
          {!info.billing.membership && (
            <div className="notice">
              {tpl ? "Templates" : "E-signatures"} need a Day Pass, Pro or Team. <Link href={`/app/${wid}/settings?tab=billing`}>See plans</Link>
            </div>
          )}
          {tpl ? (
            <>
              <div className="field">
                <label htmlFor="tpl-name">Template name</label>
                <input id="tpl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rental agreement" />
              </div>
              <div className="field">
                <label htmlFor="tpl-title">Envelope title</label>
                <input id="tpl-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                <span className="tiny faint">Signers see this in the email. You can change it each time you send.</span>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="env-title">Envelope title</label>
              <input id="env-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="env-msg">Message to signers (optional)</label>
            <textarea id="env-msg" className="textarea" style={{ minHeight: 60 }} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div>
            <div className="row between">
              <span className="eyebrow">{tpl ? "Signer roles" : "Signers"}</span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setSigners([...signers, { key: uid(), name: "", email: "", label: tpl ? `Signer ${signers.length + 1}` : undefined }]);
                  setActive(signers.length);
                }}
              >
                <I.plus size={12} /> Add
              </button>
            </div>
            {tpl && <p className="tiny faint" style={{ margin: "4px 0 0" }}>Roles are filled in each time you send (for example Client and Landlord). Fix a role to one person, like yourself as countersigner, to skip typing it.</p>}
            {signers.map((s, i) => (
              <div key={s.key} className="card card-tight mt-8" style={{ borderColor: active === i ? color(s.key) : undefined, cursor: "pointer" }} onClick={() => setActive(i)}>
                <div className="row">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: color(s.key), flexShrink: 0 }} />
                  <span className="small grow">
                    {sequential ? `${i + 1}. ` : ""}
                    {tpl ? `Role ${i + 1}` : `Signer ${i + 1}`}
                  </span>
                  <span className="tiny faint">{(() => { const n = fields.filter((f) => f.signerKey === s.key).length; return `${n} field${n === 1 ? "" : "s"}`; })()}</span>
                  {signers.length > 1 && (
                    <button
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSigners(signers.filter((x) => x.key !== s.key));
                        setFields(fields.filter((f) => f.signerKey !== s.key));
                        setActive(0);
                      }}
                      aria-label={tpl ? "Remove role" : "Remove signer"}
                    >
                      <I.x size={12} />
                    </button>
                  )}
                </div>
                {tpl ? (
                  <>
                    <input className="input input-sm mt-8" aria-label="Role name" placeholder="Role, e.g. Client" value={s.label ?? ""} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))} />
                    <label className="check mt-8 tiny" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={Boolean(s.fixed)} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, fixed: e.target.checked } : x)))} /> Always the same person
                    </label>
                    {s.fixed && (
                      <>
                        <input className="input input-sm mt-8" placeholder="Full name" value={s.name} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} />
                        <input className="input input-sm mt-8" type="email" placeholder="email@company.com" value={s.email} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, email: e.target.value } : x)))} />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <input className="input input-sm mt-8" placeholder="Full name" value={s.name} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} />
                    <input className="input input-sm mt-8" type="email" placeholder="email@company.com" value={s.email} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, email: e.target.value } : x)))} />
                  </>
                )}
              </div>
            ))}
            <button
              className="btn btn-sm btn-ghost mt-8"
              onClick={() => {
                setSigners([...signers.filter((s) => (tpl ? s.label?.trim() && (s.label !== `Signer ${signers.indexOf(s) + 1}` || fields.some((f) => f.signerKey === s.key)) : s.name || s.email)), { key: uid(), name: info.me.name, email: info.me.email, label: tpl ? "Me" : undefined, fixed: tpl }]);
              }}
            >
              + Add me as a signer
            </button>
            <label className="check mt-12">
              <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} /> Sign in order (each signer is invited after the previous one signs)
            </label>
          </div>
          <div>
            <span className="eyebrow">Place fields for {signer ? who(signer, active) : ""}</span>
            <div className="row wrap gap-4 mt-8">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <button key={k} className={`chip ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="tiny faint mt-8">
              <span className="hide-mobile">Click</span>
              <span className="show-mobile">Tap</span> on the document to place a field. Drag to move, use the corner to resize, × to remove. Each {tpl ? "role" : "signer"} needs at least one signature field.
            </p>
            <button className="btn btn-sm show-mobile mt-8" onClick={() => setStep("fields")}>
              Place fields on the document <I.right size={12} />
            </button>
          </div>
          {!tpl && (
            <p className="tiny faint" style={{ margin: 0 }}>
              Sending this document often? <Link href={`/app/${wid}/send/${docId}?mode=template`}>Save it as a reusable template</Link> with signer roles, bulk send and public signing links.
            </p>
          )}
          <div className="send-footer">
            {missing.length > 0 && (
              <ul className="send-missing">
                {missing.slice(0, 4).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={!ready || busy} onClick={tpl ? saveTemplate : send}>
              {primary}
            </button>
            {ready && !tpl && <div className="tiny faint mt-8">Signers get an email with a secure signing link{sequential ? ", one at a time in order" : ""}.</div>}
            {ready && tpl && <div className="tiny faint mt-8">Then send it to anyone, bulk send it from a spreadsheet, or share it as a public signing link.</div>}
          </div>
        </aside>
        <section className="viewer">
          <div className="send-field-bar show-mobile">
            <span className="tiny" style={{ color: signer ? color(signer.key) : undefined }}>
              <b>{signer ? who(signer, active) : ""}</b> · {KIND_LABEL[kind]}
            </span>
            <select className="select input-sm" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Field type">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {signers.length > 1 && (
              <select className="select input-sm" value={active} onChange={(e) => setActive(Number(e.target.value))} aria-label={tpl ? "Role" : "Signer"}>
                {signers.map((s, i) => (
                  <option key={s.key} value={i}>
                    {who(s, i)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="page-scroll" ref={scrollRef}>
            {versionId && (
              <PdfViewer
                src={`/api/documents/${docId}/file?version=${versionId}`}
                scale={scale}
                textLayer={false}
                scrollRef={scrollRef}
                renderOverlay={(pinfo) => (
                  <div style={{ position: "absolute", inset: 0, cursor: "copy", zIndex: 4 }} onClick={(e) => place(pinfo, e)}>
                    {fields
                      .filter((f) => f.page === pinfo.page)
                      .map((f) => (
                        <div
                          key={f.id}
                          className="sig-field"
                          style={{ left: f.x * pinfo.width, top: f.y * pinfo.height, width: f.w * pinfo.width, height: f.h * pinfo.height, borderColor: color(f.signerKey), background: `${color(f.signerKey)}22`, color: color(f.signerKey) }}
                          onPointerDown={(e) => drag(e, f, pinfo, false)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {KIND_LABEL[f.kind]}
                          <button className="del" style={{ color: color(f.signerKey) }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setFields(fields.filter((x) => x.id !== f.id))} aria-label="Remove field">
                            ×
                          </button>
                          <div className="resize" style={{ background: color(f.signerKey) }} onPointerDown={(e) => drag(e, f, pinfo, true)} />
                        </div>
                      ))}
                  </div>
                )}
              />
            )}
          </div>
          <div className="viewer-float">
            <button className="icon-btn" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} aria-label="Zoom out"><I.zoomOut size={15} /></button>
            <span>{Math.round(scale * 100)}%</span>
            <button className="icon-btn" onClick={() => setScale((s) => Math.min(2.5, s + 0.15))} aria-label="Zoom in"><I.zoomIn size={15} /></button>
          </div>
          <div className="send-mobile-done show-mobile">
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={!ready || busy} onClick={ready ? (tpl ? saveTemplate : send) : () => setStep("details")}>
              {ready ? primary : <>Back to {tpl ? "roles" : "signers"} · {missing.length} to finish</>}
            </button>
          </div>
        </section>
      </div>
      {result && (
        <Modal title="Sent for signature" onClose={() => (window.location.href = `/app/${wid}?doc=${docId}`)} footer={<Link className="btn btn-primary" href={`/app/${wid}?doc=${docId}`}>Back to document</Link>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {result.delivered > 0
              ? `Invitations emailed${sequential ? " (to the first signer; others follow in order)" : ""}. Track progress in the Workflow tab.`
              : "Email isn't configured on this server, so share each signer's private link directly:"}
          </p>
          {result.links.map((l) => (
            <div key={l.link} className="list-item">
              <div className="grow">
                {l.name}
                <div className="tiny faint">{l.email}</div>
              </div>
              <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(l.link).then(() => toast("Link copied"))}>
                <I.copy size={12} /> Copy link
              </button>
            </div>
          ))}
        </Modal>
      )}
    </AppShell>
  );
}
