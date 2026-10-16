"use client";
import { useMemo, useState } from "react";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { I } from "../icons";
import { Menu, Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";

export function Library() {
  const { docs, active, openDoc, showUpload, info, wid, reloadDocs, upsertDoc } = useWB();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Doc | null>(null);
  const [tagging, setTagging] = useState<Doc | null>(null);
  const [trash, setTrash] = useState<Doc[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const allTags = useMemo(() => [...new Set(docs.flatMap((d) => d.tags))].sort(), [docs]);
  const shown = docs.filter(
    (d) => (!filter || d.name.toLowerCase().includes(filter.toLowerCase())) && (!tag || d.tags.includes(tag)),
  );
  const mine = docs.filter((d) => d.checkedOutBy?.id === info.me.id).length;

  const remove = async (d: Doc) => {
    if (!confirm(`Move “${d.name}” to trash?`)) return;
    try {
      await api(`/api/documents/${d.id}`, { method: "DELETE" });
      toast("Moved to trash");
      if (active?.id === d.id) openDoc(null);
      void reloadDocs();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const loadTrash = async () => {
    const r = await api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents?trash=1`);
    setTrash(r.documents);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    toast(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    try {
      const r = await api<{ documents: Doc[]; errors: { name: string; error: string }[] }>(`/api/workspaces/${wid}/documents`, { method: "POST", body: form });
      r.documents.forEach(upsertDoc);
      if (r.documents[0]) openDoc(r.documents[0].id);
      r.errors.forEach((er) => toast(`${er.name}: ${er.error}`, "error"));
      if (r.documents.length) toast(`Added ${r.documents.length} document${r.documents.length > 1 ? "s" : ""}`, "success");
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };

  return (
    <aside
      className="rail"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={dragOver ? { outline: "2px dashed var(--amber)", outlineOffset: -6 } : undefined}
    >
      <div className="rail-head">
        <span className="eyebrow">Library</span>
        <button className="btn btn-primary btn-sm" onClick={showUpload}>
          <I.plus size={14} /> Upload
        </button>
      </div>
      <div style={{ padding: "0 12px 8px" }}>
        <input className="input input-sm" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter documents" />
        {allTags.length > 0 && (
          <div className="row wrap gap-4 mt-8">
            {allTags.map((t) => (
              <button key={t} className={`chip ${tag === t ? "active" : ""}`} onClick={() => setTag(tag === t ? null : t)}>
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rail-list">
        {docs.length === 0 && (
          <div className="empty">
            <h3>No documents yet</h3>
            Upload PDFs, Office files or images — or drag them here.
            <div className="mt-12">
              <button className="btn btn-primary btn-sm" onClick={showUpload}>
                <I.upload size={14} /> Upload documents
              </button>
            </div>
          </div>
        )}
        {shown.map((d) => (
          <div key={d.id} className="menu-wrap">
            <button className={`doc-item ${active?.id === d.id ? "active" : ""}`} onClick={() => openDoc(d.id)}>
              <div className="doc-icon">{d.sourceType === "pdf" ? "PDF" : d.sourceType.toUpperCase().slice(0, 4)}</div>
              <div className="grow">
                <div className="doc-name ellipsis" title={d.name}>
                  {d.name}
                </div>
                <div className="doc-sub">
                  <span>
                    {d.pageCount} {d.pageCount === 1 ? "page" : "pages"} · {timeAgo(d.updatedAt)}
                  </span>
                  {d.checkedOutBy && (
                    <span title={`Checked out by ${d.checkedOutBy.name}`} style={{ color: d.checkedOutBy.id === info.me.id ? "var(--amber)" : "var(--steel)", display: "inline-flex" }}>
                      <I.lock size={11} />
                    </span>
                  )}
                  {d.scanned && <span className="badge badge-info" title="Scanned — run OCR to make it searchable">scan</span>}
                </div>
              </div>
            </button>
            <button
              className="icon-btn"
              style={{ position: "absolute", right: 4, top: 8 }}
              aria-label="Document actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenuFor(menuFor === d.id ? null : d.id);
              }}
            >
              <I.more size={14} />
            </button>
            <Menu open={menuFor === d.id} onClose={() => setMenuFor(null)}>
              <button className="menu-item" onClick={() => { setMenuFor(null); setRenaming(d); }}>
                <I.edit size={14} /> Rename
              </button>
              <button className="menu-item" onClick={() => { setMenuFor(null); setTagging(d); }}>
                <I.tag size={14} /> Tags
              </button>
              <a className="menu-item" href={`/api/documents/${d.id}/file?download=1`}>
                <I.download size={14} /> Download PDF
              </a>
              <div className="menu-sep" />
              <button className="menu-item" style={{ color: "var(--bad)" }} onClick={() => { setMenuFor(null); void remove(d); }}>
                <I.trash size={14} /> Move to trash
              </button>
            </Menu>
          </div>
        ))}
        {docs.length > 0 && shown.length === 0 && <div className="empty small">No documents match.</div>}
      </div>
      <div className="rail-foot">
        <div className="kb-stat">
          Knowledge base: <b>{info.stats.docs}</b> docs · <b>{info.stats.pages}</b> pages
          <br />
          searchable across every upload
          {mine > 0 && (
            <>
              <br />
              {mine} checked out by you
            </>
          )}
        </div>
        <button className="btn btn-ghost btn-sm mt-8" onClick={loadTrash}>
          <I.trash size={13} /> Trash
        </button>
      </div>

      {renaming && <RenameModal doc={renaming} onClose={() => setRenaming(null)} />}
      {tagging && <TagModal doc={tagging} onClose={() => setTagging(null)} suggestions={allTags} />}
      {trash && (
        <Modal title="Trash" onClose={() => setTrash(null)}>
          {trash.length === 0 && <div className="empty">Trash is empty.</div>}
          {trash.map((d) => (
            <div className="list-item" key={d.id}>
              <I.file size={16} />
              <div className="grow ellipsis">{d.name}</div>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await api(`/api/documents/${d.id}/restore`, { method: "POST" });
                  toast("Restored", "success");
                  setTrash((t) => t?.filter((x) => x.id !== d.id) ?? null);
                  void reloadDocs();
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </Modal>
      )}
    </aside>
  );
}

function RenameModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { upsertDoc } = useWB();
  const toast = useToast();
  const [name, setName] = useState(doc.name);
  const save = async () => {
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${doc.id}`, { method: "PATCH", json: { name } });
      upsertDoc(r.document);
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Modal title="Rename document" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Save</button></>}>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
    </Modal>
  );
}

function TagModal({ doc, onClose, suggestions }: { doc: Doc; onClose: () => void; suggestions: string[] }) {
  const { upsertDoc } = useWB();
  const toast = useToast();
  const [tags, setTags] = useState(doc.tags);
  const [input, setInput] = useState("");
  const add = (t: string) => {
    const v = t.trim().toLowerCase().replace(/^#/, "");
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setInput("");
  };
  const save = async () => {
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${doc.id}`, { method: "PATCH", json: { tags } });
      upsertDoc(r.document);
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Modal title="Tags" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <div className="row wrap gap-4">
        {tags.map((t) => (
          <button key={t} className="chip active" onClick={() => setTags(tags.filter((x) => x !== t))}>
            #{t} ×
          </button>
        ))}
      </div>
      <input
        className="input mt-12"
        placeholder="Add a tag and press Enter"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(input);
          }
        }}
      />
      {suggestions.filter((s) => !tags.includes(s)).length > 0 && (
        <div className="row wrap gap-4 mt-12">
          {suggestions.filter((s) => !tags.includes(s)).map((s) => (
            <button key={s} className="chip" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
