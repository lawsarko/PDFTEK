"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { I } from "./icons";
import { Modal } from "./modal";
import { useToast } from "./toast";

export type Provider = "google" | "dropbox" | "onedrive";
export type Connection = { provider: Provider; name: string; available: boolean; connected: boolean; account: string | null };
type Item = { id: string; name: string; folder: boolean; size?: number; modified?: string };

/** Brand colours, used for a small mark next to each service's name. */
const COLOR: Record<Provider, string> = { google: "#1a73e8", dropbox: "#0061fe", onedrive: "#0364b8" };

export function CloudMark({ provider, size = 28 }: { provider: Provider; size?: number }) {
  return (
    <span className="cloud-mark" style={{ background: COLOR[provider], width: size, height: size }} aria-hidden>
      <I.folder size={Math.round(size * 0.55)} />
    </span>
  );
}

export function useCloud() {
  const [list, setList] = useState<Connection[] | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await api<{ connections: Connection[] }>("/api/cloud")).connections);
    } catch {
      setList([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const connect = (p: Provider, returnTo = window.location.pathname + window.location.search) => {
    window.location.href = `/api/cloud/${p}/connect?return=${encodeURIComponent(returnTo)}`;
  };
  const disconnect = async (p: Provider) => {
    setList((await api<{ connections: Connection[] }>(`/api/cloud/${p}`, { method: "DELETE" })).connections);
  };
  return { list, reload: load, connect, disconnect };
}

const size = (n?: number) => (n === undefined ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------- Google's file picker ----------

type GooglePicker = {
  picker: {
    DocsView: new (viewId?: string) => { setIncludeFolders(b: boolean): unknown; setSelectFolderEnabled(b: boolean): unknown; setMimeTypes(m: string): unknown };
    ViewId: { DOCS: string };
    PickerBuilder: new () => {
      addView(v: unknown): GoogleBuilder;
    };
    Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
    Action: { PICKED: string; CANCEL: string };
  };
};
type GoogleBuilder = {
  addView(v: unknown): GoogleBuilder;
  enableFeature(f: string): GoogleBuilder;
  setOAuthToken(t: string): GoogleBuilder;
  setDeveloperKey(k: string): GoogleBuilder;
  setAppId(a: string): GoogleBuilder;
  setTitle(t: string): GoogleBuilder;
  setCallback(cb: (d: { action: string; docs?: { id: string; name: string }[] }) => void): GoogleBuilder;
  build(): { setVisible(v: boolean): void };
};

let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  pickerReady ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => (window as unknown as { gapi: { load(n: string, cb: () => void): void } }).gapi.load("picker", () => resolve());
    s.onerror = () => {
      pickerReady = null;
      reject(new Error("Google Drive couldn't be reached. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return pickerReady;
}

const PICK_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
  "image/heic",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
].join(",");

async function pickFromGoogle(): Promise<string[]> {
  const cfg = await api<{ apiKey: string; appId: string; token: string }>("/api/cloud/google/picker");
  await loadPicker();
  const g = (window as unknown as { google: GooglePicker }).google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS);
    view.setIncludeFolders(true);
    view.setSelectFolderEnabled(false);
    view.setMimeTypes(PICK_MIME);
    new g.picker.PickerBuilder()
      .addView(view)
      .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(cfg.token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setTitle("Choose files to open in pdftek")
      .setCallback((d) => {
        if (d.action === g.picker.Action.PICKED) resolve((d.docs ?? []).map((x) => x.id));
        else if (d.action === g.picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}

// ---------- import ----------

/** Pick files from a connected cloud account and copy them into the workspace library. */
export function CloudImport({ wid, onImported }: { wid: string; onImported: (docs: Doc[]) => void }) {
  const toast = useToast();
  const { list, connect } = useCloud();
  const usable = useMemo(() => (list ?? []).filter((c) => c.available), [list]);
  const [active, setActive] = useState<Provider | null>(null);
  const current = usable.find((c) => c.provider === active) ?? usable.find((c) => c.connected) ?? usable[0] ?? null;
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folder = path[path.length - 1]?.id ?? "";
  const browse = current?.connected && current.provider !== "google";

  useEffect(() => {
    if (!browse || !current) return;
    let stale = false;
    setItems(null);
    setError(null);
    const t = setTimeout(
      () =>
        api<{ items: Item[] }>(`/api/cloud/${current.provider}/files?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}`)
          .then((r) => !stale && setItems(r.items))
          .catch((e) => !stale && (setError(errMsg(e)), setItems([]))),
      query ? 350 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [browse, current, folder, query]);

  const switchTo = (p: Provider) => {
    setActive(p);
    setPath([]);
    setQuery("");
    setPicked(new Set());
  };

  const importIds = async (p: Provider, ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ documents: Doc[]; errors: { id: string; error: string }[] }>(`/api/cloud/${p}/import`, { method: "POST", json: { workspaceId: wid, ids } });
      r.errors.slice(0, 3).forEach((e) => toast(e.error, "error"));
      if (r.documents.length) {
        toast(`Added ${r.documents.length} file${r.documents.length === 1 ? "" : "s"} from ${current?.name}`, "success");
        onImported(r.documents);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (list === null) return <span className="spinner" />;
  if (!usable.length)
    return (
      <div className="empty">
        <I.folder size={22} />
        <p className="small muted">Cloud storage isn&apos;t set up on this server yet. Upload files from your device instead.</p>
      </div>
    );

  return (
    <div className="col gap-12">
      <div className="cloud-tabs" role="tablist" aria-label="Cloud storage">
        {usable.map((c) => (
          <button key={c.provider} role="tab" aria-selected={current?.provider === c.provider} className={`cloud-tab ${current?.provider === c.provider ? "on" : ""}`} onClick={() => switchTo(c.provider)}>
            <CloudMark provider={c.provider} size={20} />
            {c.name}
            {c.connected && <span className="dot" style={{ background: "var(--good)", boxShadow: "none" }} aria-label="connected" />}
          </button>
        ))}
      </div>

      {current && !current.connected ? (
        <div className="cloud-connect">
          <CloudMark provider={current.provider} size={40} />
          <b>Connect {current.name}</b>
          <p className="small muted">
            Open files from {current.name} without downloading them first, and save your results back to it.
            {current.provider === "google" ? " pdftek only sees the files you choose." : ""}
          </p>
          <button className="btn btn-primary" onClick={() => connect(current.provider, `/app/${wid}?add=cloud`)}>
            Connect {current.name}
          </button>
        </div>
      ) : current?.provider === "google" ? (
        <div className="cloud-connect">
          <CloudMark provider="google" size={40} />
          <b>Choose files from Google Drive</b>
          <p className="small muted">
            Signed in as {current.account || "your Google account"}. PDFs, Word, Excel, PowerPoint, images and Google Docs, Sheets and Slides (converted on the way).
          </p>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              try {
                await importIds("google", await pickFromGoogle());
              } catch (e) {
                setError(errMsg(e));
              }
            }}
          >
            {busy ? <span className="spinner" /> : <I.folder size={14} />} {busy ? "Importing…" : "Open Google Drive"}
          </button>
        </div>
      ) : current ? (
        <>
          <div className="row gap-8 wrap">
            <nav className="cloud-crumbs grow" aria-label="Folder">
              <button className="btn-link" onClick={() => setPath([])} disabled={!path.length}>
                {current.name}
              </button>
              {path.map((p, i) => (
                <span key={p.id}>
                  <span className="faint"> / </span>
                  <button className="btn-link" onClick={() => setPath(path.slice(0, i + 1))} disabled={i === path.length - 1}>
                    {p.name}
                  </button>
                </span>
              ))}
            </nav>
            <div className="tr-search cloud-search">
              <I.search size={14} />
              <input className="input input-sm" placeholder={`Search ${current.name}`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${current.name}`} />
            </div>
          </div>
          <div className="cloud-list" role="listbox" aria-multiselectable="true" aria-label="Files">
            {items === null && (
              <div className="empty">
                <span className="spinner" />
              </div>
            )}
            {items?.length === 0 && !error && <div className="empty small">{query ? "No matching files." : "This folder has no files pdftek can open."}</div>}
            {items?.map((it) =>
              it.folder ? (
                <button key={it.id} className="cloud-row" onClick={() => (setQuery(""), setPath([...path, { id: it.id, name: it.name }]))}>
                  <I.folder size={16} />
                  <span className="grow ellipsis">{it.name}</span>
                  <I.right size={12} />
                </button>
              ) : (
                <label key={it.id} className={`cloud-row ${picked.has(it.id) ? "on" : ""}`} role="option" aria-selected={picked.has(it.id)}>
                  <input
                    type="checkbox"
                    checked={picked.has(it.id)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(it.id);
                      else n.delete(it.id);
                      setPicked(n);
                    }}
                  />
                  <I.file size={16} />
                  <span className="grow ellipsis">{it.name}</span>
                  <span className="tiny faint mono">{size(it.size)}</span>
                </label>
              ),
            )}
          </div>
          <div className="row between wrap gap-8">
            <span className="tiny faint">{current.account ? `Signed in as ${current.account}` : ""}</span>
            <button className="btn btn-primary" disabled={!picked.size || busy} onClick={() => void importIds(current.provider, [...picked])}>
              {busy ? <span className="spinner" /> : <I.upload size={14} />} {busy ? "Importing…" : `Open ${picked.size || ""} file${picked.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      ) : null}
      {error && <div className="notice notice-bad">{error}</div>}
    </div>
  );
}

// ---------- save back ----------

/** Saves a library document (or a file made in the browser) to a connected cloud account. */
export function SaveToCloudModal({ documentId, file, name, onClose }: { documentId?: string; file?: Blob; name?: string; onClose: () => void }) {
  const toast = useToast();
  const { list, connect } = useCloud();
  const usable = (list ?? []).filter((c) => c.available);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [done, setDone] = useState<{ provider: Provider; url: string | null; location: string } | null>(null);

  const save = async (p: Provider) => {
    setBusy(p);
    try {
      let r: { url: string | null; location: string };
      if (file) {
        const form = new FormData();
        form.append("file", file, name ?? "Document");
        if (name) form.append("name", name);
        r = await api(`/api/cloud/${p}/export`, { method: "POST", body: form });
      } else r = await api(`/api/cloud/${p}/export`, { method: "POST", json: { documentId } });
      setDone({ provider: p, ...r });
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const conn = (p: Provider) => usable.find((c) => c.provider === p);
  return (
    <Modal title="Save to cloud storage" onClose={onClose} footer={<button className="btn" onClick={onClose}>{done ? "Done" : "Cancel"}</button>}>
      {list === null ? (
        <span className="spinner" />
      ) : done ? (
        <div className="tr-done">
          <span className="tr-done-ico">
            <I.check size={20} />
          </span>
          <div>
            <b>Saved to {conn(done.provider)?.name}</b>
            <div className="small muted">In {done.location}, folder “pdftek”.</div>
            {done.url && (
              <a className="btn btn-sm mt-8" href={done.url} target="_blank" rel="noopener">
                Open in {conn(done.provider)?.name}
              </a>
            )}
          </div>
        </div>
      ) : !usable.length ? (
        <p className="small muted" style={{ margin: 0 }}>Cloud storage isn&apos;t set up on this server yet.</p>
      ) : (
        <div className="col gap-8">
          {name && (
            <div className="tool-doc">
              <I.file size={14} /> <span className="grow ellipsis">{name}</span>
            </div>
          )}
          {usable.map((c) => (
            <div key={c.provider} className="cloud-save-row">
              <CloudMark provider={c.provider} />
              <span className="grow">
                <b className="small">{c.name}</b>
                <span className="tiny faint" style={{ display: "block" }}>
                  {c.connected ? c.account || "Connected" : "Not connected"}
                </span>
              </span>
              {c.connected ? (
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void save(c.provider)}>
                  {busy === c.provider ? <span className="spinner" /> : null} Save here
                </button>
              ) : (
                <button className="btn btn-sm" onClick={() => connect(c.provider)}>
                  Connect
                </button>
              )}
            </div>
          ))}
          <p className="tiny faint" style={{ margin: "4px 0 0" }}>Files are saved in a folder called “pdftek”.</p>
        </div>
      )}
    </Modal>
  );
}
