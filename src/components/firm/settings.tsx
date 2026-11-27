"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { I } from "../icons";
import { useToast } from "../toast";
import { PageHead, useFirm } from "./shell";

const COLORS = ["#b84a0b", "#1a73e8", "#0b8043", "#7b1fa2", "#c5221f", "#00796b", "#3c4043", "#1e3a5f"];

export function FirmSettings({ wid }: { wid: string }) {
  const toast = useToast();
  const { firm, reload } = useFirm();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState("#b84a0b");
  const [retention, setRetention] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!firm) return;
    setName(firm.firmName || firm.workspaceName);
    setSlug(firm.slug);
    setColor(firm.color);
    setRetention(firm.retentionYears ? String(firm.retentionYears) : "");
  }, [firm]);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/workspaces/${wid}/firm`, { method: "PATCH", json: { firmName: name, slug, brandColor: color, retentionYears: retention ? Number(retention) : null } });
      toast("Firm settings saved.", "success");
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function logo(file: File | null) {
    try {
      if (!file) await api(`/api/workspaces/${wid}/firm/logo`, { method: "DELETE" });
      else {
        const f = new FormData();
        f.append("file", file);
        await api(`/api/workspaces/${wid}/firm/logo`, { method: "POST", body: f });
      }
      toast(file ? "Logo updated." : "Logo removed.", "success");
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }
  if (!firm) return <div className="fa-loading"><span className="spinner spinner-lg" /></div>;
  const host = firm.host ? firm.host.replace(firm.slug, slug || firm.slug) : null;
  return (
    <div className="fa-page fa-narrow">
      <PageHead title="Firm settings" sub="How your firm appears to clients in the portal and in emails." />
      <div className="fa-card fa-form">
        <div className="field">
          <label htmlFor="fs-name">Firm name</label>
          <input id="fs-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sark Tax & Accounting" />
        </div>
        <div className="field">
          <label htmlFor="fs-slug">Your client portal address</label>
          <div className="fa-slug">
            <input id="fs-slug" className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={30} />
            <span>.{firm.host ? firm.host.slice(firm.slug.length + 1) : "pdftek.com"}</span>
          </div>
          <span className="small muted">
            Clients sign in at <b>{host ?? `${slug}.pdftek.com`}</b>. Letters, numbers and hyphens.
            {!firm.subdomains && " Until the firm addresses are switched on for this server, links point to the same portal at " + firm.portalUrl.replace(/^https?:\/\//, "") + "."}
          </span>
        </div>
        <div className="field">
          <label>Brand color</label>
          <div className="fa-swatches">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`fa-swatch ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`}>
                {color === c && <I.check size={14} />}
              </button>
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom color" className="fa-swatch-custom" />
          </div>
        </div>
        <div className="field">
          <label>Logo</label>
          <div className="row gap-12 wrap">
            <span className="fa-logo-preview">{firm.logo ? <img src={`${firm.logo}?v=${Date.now()}`} alt="" /> : <span className="faint small">No logo</span>}</span>
            <label className="btn btn-sm">
              <I.upload size={14} /> Upload logo
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} />
            </label>
            {firm.logo && (
              <button className="btn btn-sm btn-ghost" onClick={() => logo(null)}>
                Remove
              </button>
            )}
          </div>
          <span className="small muted">A wide PNG or SVG on a transparent background works best.</span>
        </div>
        <div className="field">
          <label htmlFor="fs-ret">Keep client documents for</label>
          <select id="fs-ret" className="select" value={retention} onChange={(e) => setRetention(e.target.value)}>
            <option value="">As long as you keep them (no automatic deletion)</option>
            {[3, 4, 5, 6, 7, 10].map((y) => (
              <option key={y} value={y}>
                {y} years after the fiscal year, then move to the trash
              </option>
            ))}
          </select>
          <span className="small muted">Many professions must keep client records for several years (tax preparers often keep 7). Check the rules that apply to you.</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="fa-card fa-preview-card">
        <div className="fa-label">Preview</div>
        <div className="fa-preview" style={{ "--firm": color } as React.CSSProperties}>
          <div className="fa-preview-bar">
            {firm.logo ? <img src={firm.logo} alt="" /> : <span className="fa-brand-mark" style={{ background: color }}>{name.slice(0, 1).toUpperCase() || "F"}</span>}
            <b>{name || "Your firm"}</b>
          </div>
          <div className="fa-preview-body">
            <b>Welcome back</b>
            <span className="small muted">Enter your email and we’ll send you a sign-in code.</span>
            <span className="fa-preview-input" />
            <span className="fa-preview-btn" style={{ background: color }}>Send code</span>
          </div>
        </div>
      </div>
    </div>
  );
}
