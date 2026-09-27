"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { PdfViewer, type PageInfo } from "@/components/pdf-viewer";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";

type Kind = "signature" | "initials" | "date" | "name" | "text";
type Signer = { key: string; name: string; email: string };
type Field = { id: string; signerKey: string; page: number; x: number; y: number; w: number; h: number; kind: Kind };

const COLORS = ["#d98e2b", "#6ea8e0", "#6fb37a", "#c77dd8", "#e06a5c", "#e0c04a"];
const SIZE: Record<Kind, [number, number]> = { signature: [0.28, 0.06], initials: [0.09, 0.045], date: [0.16, 0.028], name: [0.22, 0.028], text: [0.25, 0.028] };
const KIND_LABEL: Record<Kind, string> = { signature: "Signature", initials: "Initials", date: "Date signed", name: "Full name", text: "Text box" };
const uid = () => Math.random().toString(36).slice(2, 9);

export function SendForSignature({ wid, docId }: { wid: string; docId: string }) {
  const toast = useToast();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sequential, setSequential] = useState(false);
  const [signers, setSigners] = useState<Signer[]>([{ key: uid(), name: "", email: "" }]);
  const [active, setActive] = useState(0);
  const [kind, setKind] = useState<Kind>("signature");
  const [fields, setFields] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ delivered: number; links: { name: string; email: string; link: string }[] } | null>(null);
  const [scale, setScale] = useState(1.2);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ document: Doc }>(`/api/documents/${docId}`).then((r) => {
      setDoc(r.document);
      setTitle(r.document.name.replace(/\.pdf$/i, ""));
    });
    api<WorkspaceInfo>(`/api/workspaces/${wid}`).then(setInfo);
  }, [docId, wid]);

  const signer = signers[active];
  const color = (key: string) => COLORS[signers.findIndex((s) => s.key === key) % COLORS.length];

  const place = (info: PageInfo, e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = SIZE[kind];
    const x = Math.min(1 - w, Math.max(0, (e.clientX - r.left) / info.width - w / 2));
    const y = Math.min(1 - h, Math.max(0, (e.clientY - r.top) / info.height - h / 2));
    setFields((f) => [...f, { id: uid(), signerKey: signer.key, page: info.page, x, y, w, h, kind }]);
  };

  const drag = (e: React.PointerEvent, f: Field, info: PageInfo, resize: boolean) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / info.width;
      const dy = (ev.clientY - sy) / info.height;
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
        json: { documentId: docId, title, message, sequential, signers, fields: fields.map(({ id: _id, ...f }) => f) },
      });
      setResult(r);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const ready = title.trim() && signers.every((s) => s.name.trim() && /.+@.+\..+/.test(s.email)) && signers.every((s) => fields.some((f) => f.signerKey === s.key && f.kind === "signature"));

  if (!doc || !info) return <div className="empty"><span className="spinner spinner-lg" /></div>;

  return (
    <AppShell
      wid={wid}
      title={`Request signatures · ${doc.name}`}
      actions={
        <button className="btn btn-primary btn-sm" disabled={!ready || busy} onClick={send}>
          {busy && <span className="spinner" />} Send for signature
        </button>
      }
    >
      <div className="main" style={{ height: "calc(100vh - 56px)" }}>
        <aside className="rail" style={{ width: 320, overflowY: "auto", padding: 16, gap: 16, display: "flex", flexDirection: "column" }}>
          {info.workspace.plan === "free" && (
            <div className="notice">
              E-signatures are a Pro feature. <Link href={`/app/${wid}/settings?tab=billing`}>Start a free trial</Link> to send.
            </div>
          )}
          <div className="field">
            <label>Envelope title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Message to signers (optional)</label>
            <textarea className="textarea" style={{ minHeight: 60 }} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div>
            <div className="row between">
              <span className="eyebrow">Signers</span>
              <button className="btn btn-sm btn-ghost" onClick={() => { setSigners([...signers, { key: uid(), name: "", email: "" }]); setActive(signers.length); }}>
                <I.plus size={12} /> Add
              </button>
            </div>
            {signers.map((s, i) => (
              <div key={s.key} className="card card-tight mt-8" style={{ borderColor: active === i ? color(s.key) : undefined, cursor: "pointer" }} onClick={() => setActive(i)}>
                <div className="row">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: color(s.key) }} />
                  <span className="small grow">{sequential ? `${i + 1}. ` : ""}Signer {i + 1}</span>
                  <span className="tiny faint">{fields.filter((f) => f.signerKey === s.key).length} fields</span>
                  {signers.length > 1 && (
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setSigners(signers.filter((x) => x.key !== s.key)); setFields(fields.filter((f) => f.signerKey !== s.key)); setActive(0); }} aria-label="Remove signer">
                      <I.x size={12} />
                    </button>
                  )}
                </div>
                <input className="input input-sm mt-8" placeholder="Full name" value={s.name} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} />
                <input className="input input-sm mt-8" type="email" placeholder="email@company.com" value={s.email} onChange={(e) => setSigners(signers.map((x) => (x.key === s.key ? { ...x, email: e.target.value } : x)))} />
              </div>
            ))}
            <button className="btn btn-sm btn-ghost mt-8" onClick={() => { setSigners([...signers.filter((s) => s.name || s.email), { key: uid(), name: info.me.name, email: info.me.email }]); }}>
              + Add me as a signer
            </button>
            <label className="check mt-12">
              <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} /> Sign in order (each signer is invited after the previous one signs)
            </label>
          </div>
          <div>
            <span className="eyebrow">Place fields for {signer?.name || `Signer ${active + 1}`}</span>
            <div className="row wrap gap-4 mt-8">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <button key={k} className={`chip ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="tiny faint mt-8">Click on the document to place a field. Drag to move, use the corner to resize, × to remove. Each signer needs at least one signature field.</p>
          </div>
        </aside>
        <section className="viewer">
          <div className="page-scroll" ref={scrollRef}>
            <PdfViewer
              src={`/api/documents/${docId}/file?version=${doc.versionId}`}
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
          </div>
          <div className="viewer-float">
            <button className="icon-btn" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} aria-label="Zoom out"><I.zoomOut size={15} /></button>
            <span>{Math.round(scale * 100)}%</span>
            <button className="icon-btn" onClick={() => setScale((s) => Math.min(2.5, s + 0.15))} aria-label="Zoom in"><I.zoomIn size={15} /></button>
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
