"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { I } from "../icons";
import { Menu, Modal } from "../modal";
import { useToast } from "../toast";
import { UsageCard } from "../paywall";
import { useWB } from "./context";
import { DocThumb } from "./thumbs";
import { ToolArt } from "./tools-panel";
import { RIBBON, type Act } from "./ribbon";
import { GlobalSearch } from "./topbar";

const ACTS: Act[] = RIBBON.flatMap((g) => g.acts);
const act = (key: string) => ACTS.find((a) => a.key === key)!;

/** The six things people start with most. Each runs the matching tool (asking for a file first). */
const QUICK: { key: string; title: string; sub: string }[] = [
  { key: "convert-docx", title: "Convert", sub: "PDF to Word, Excel, images and back" },
  { key: "edit", title: "Edit PDF", sub: "Change text, add images, highlight" },
  { key: "sign", title: "Sign or send", sub: "Sign yourself or request signatures" },
  { key: "fill", title: "Fill a form", sub: "AI finds and fills every field" },
  { key: "scan", title: "Scan", sub: "Camera to a clean, searchable PDF" },
  { key: "ask", title: "Ask AI", sub: "Summaries and answers with page cites" },
];

const KIND: Record<string, [string, string]> = {
  pdf: ["PDF", "pdf"],
  docx: ["DOC", "doc"],
  doc: ["DOC", "doc"],
  xlsx: ["XLS", "xls"],
  xls: ["XLS", "xls"],
  csv: ["CSV", "xls"],
  pptx: ["PPT", "ppt"],
  ppt: ["PPT", "ppt"],
};
export function FileBadge({ type }: { type: string }) {
  const [label, cls] = KIND[type] ?? [type.toUpperCase().slice(0, 4), "img"];
  return <span className={`wb-ft ${cls}`}>{label}</span>;
}

type Filter = "all" | "pdf" | "office" | "scan" | "mine" | `#${string}`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Left navigation of the home screen. */
export function HomeNav({ run, onTrash }: { run: (key: string) => void; onTrash: () => void }) {
  const { wid, docs, section, setSection, showUpload, openAI } = useWB();
  const [newOpen, setNewOpen] = useState(false);
  const item = (on: boolean, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <>
      {icon}
      <span className="grow">{label}</span>
      {extra}
    </>
  );
  return (
    <nav className="wb-nav" aria-label="Workbench">
      <div className="menu-wrap">
        <button className="wb-new" onClick={() => setNewOpen((v) => !v)} aria-haspopup="menu">
          <I.plus size={22} /> New
        </button>
        <Menu open={newOpen} onClose={() => setNewOpen(false)} align="left">
          <button className="menu-item" onClick={() => { setNewOpen(false); showUpload("upload"); }}>
            <I.upload size={14} /> Upload files
          </button>
          <button className="menu-item" onClick={() => { setNewOpen(false); showUpload("cloud"); }}>
            <I.folder size={14} /> From Google Drive, Dropbox or OneDrive
          </button>
          <button className="menu-item" onClick={() => { setNewOpen(false); showUpload("scan"); }}>
            <I.camera size={14} /> Scan with camera
          </button>
          <button className="menu-item" onClick={() => { setNewOpen(false); showUpload("images"); }}>
            <I.image size={14} /> Images to PDF
          </button>
          <button className="menu-item" onClick={() => { setNewOpen(false); run("topdf"); }}>
            <I.file size={14} /> Word, Excel or PowerPoint to PDF
          </button>
          <button className="menu-item" onClick={() => { setNewOpen(false); run("merge"); }}>
            <I.merge size={14} /> Merge documents
          </button>
        </Menu>
      </div>
      <button className={`wb-ni ${section === "home" ? "on" : ""}`} onClick={() => setSection("home")}>
        {item(section === "home", <I.home size={20} />, "Home")}
      </button>
      <button className={`wb-ni ${section === "documents" ? "on" : ""}`} onClick={() => setSection("documents")}>
        {item(section === "documents", <I.folder size={20} />, "Documents", <span className="wb-n">{docs.length}</span>)}
      </button>
      <Link className="wb-ni" href={`/app/${wid}/clients`}>
        {item(false, <I.users size={20} />, "Clients")}
      </Link>
      <Link className="wb-ni" href={`/app/${wid}/signatures`}>
        {item(false, <I.sign size={20} />, "Signatures")}
      </Link>
      <Link className="wb-ni" href={`/app/${wid}/requests`}>
        {item(false, <I.inbox size={20} />, "Requests")}
      </Link>
      <button className="wb-ni" onClick={() => openAI("automate")}>
        {item(false, <I.bolt size={20} />, "Automations")}
      </button>
      <Link className="wb-ni" href={`/app/${wid}/tools`}>
        {item(false, <I.tools size={20} />, "All tools")}
      </Link>
      <button className="wb-ni" onClick={onTrash}>
        {item(false, <I.trash size={20} />, "Trash")}
      </button>
      <div className="grow" />
      <UsageCard wid={wid} />
    </nav>
  );
}

/** The home screen: quick starts and documents. */
export function Home({ run }: { run: (key: string) => void }) {
  const { docs, openDoc, showUpload, info, wid, reloadDocs, upsertDoc, section, setSection } = useWB();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [name, setName] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Doc | null>(null);
  const [tagging, setTagging] = useState<Doc | null>(null);
  const [trash, setTrash] = useState<Doc[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Phones always get the compact list.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("pdftek-home-view") === "list") setView("list");
    } catch {}
    const mq = window.matchMedia("(max-width: 600px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const shownView = phone ? "list" : view;
  const pickView = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem("pdftek-home-view", v);
    } catch {}
  };

  const allTags = useMemo(() => [...new Set(docs.flatMap((d) => d.tags))].sort(), [docs]);
  const mine = docs.filter((d) => d.checkedOutBy?.id === info.me.id).length;
  const shown = docs.filter((d) => {
    if (name && !d.name.toLowerCase().includes(name.toLowerCase())) return false;
    if (filter === "pdf") return d.sourceType === "pdf";
    if (filter === "office") return /^(docx?|xlsx?|pptx?|csv|txt|rtf|odt)$/.test(d.sourceType);
    if (filter === "scan") return d.scanned;
    if (filter === "mine") return d.checkedOutBy?.id === info.me.id;
    if (filter.startsWith("#")) return d.tags.includes(filter.slice(1));
    return true;
  });
  const list = section === "home" && filter === "all" && !name ? shown.slice(0, 12) : shown;

  const remove = async (d: Doc) => {
    if (!confirm(`Move “${d.name}” to trash?`)) return;
    try {
      await api(`/api/documents/${d.id}`, { method: "DELETE" });
      toast("Moved to trash");
      void reloadDocs();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const loadTrash = async () => {
    try {
      const r = await api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents?trash=1`);
      setTrash(r.documents);
    } catch (e) {
      toast(errMsg(e), "error");
    }
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

  const chips: [Filter, string][] = [
    ["all", "All"],
    ["pdf", "PDFs"],
    ["office", "From Office"],
    ["scan", "Scans"],
    ...(mine ? ([["mine", "Checked out by me"]] as [Filter, string][]) : []),
    ...allTags.map((t) => [`#${t}`, `#${t}`] as [Filter, string]),
  ];

  const actions = (d: Doc) => (
    <>
      <button
        className="wb-ibtn wb-card-more"
        aria-label="Document actions"
        onClick={(e) => {
          e.stopPropagation();
          setMenuFor(menuFor === d.id ? null : d.id);
        }}
      >
        <I.more size={18} />
      </button>
      <Menu open={menuFor === d.id} onClose={() => setMenuFor(null)}>
        <button className="menu-item" onClick={() => { setMenuFor(null); openDoc(d.id); }}>
          <I.file size={14} /> Open
        </button>
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
    </>
  );

  const sub = (d: Doc) => (
    <span className="wb-cs">
      {d.pageCount} {d.pageCount === 1 ? "page" : "pages"} · {timeAgo(d.updatedAt)}
      {d.checkedOutBy && (
        <span className="wb-lock" title={`Checked out by ${d.checkedOutBy.name}`} data-mine={d.checkedOutBy.id === info.me.id || undefined}>
          <I.lock size={11} />
        </span>
      )}
      {d.scanned && <span className="wb-tag o" title="Scanned — run OCR to make it searchable">Scan</span>}
      {d.tags.slice(0, 2).map((t) => (
        <span key={t} className="wb-tag">
          #{t}
        </span>
      ))}
    </span>
  );

  const first = info.me.name.split(" ")[0];
  return (
    <>
      <HomeNav run={run} onTrash={loadTrash} />
      <section
        className={`wb-home ${dragOver ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <div className="wb-phsearch show-mobile">
          <GlobalSearch />
        </div>
        {section === "home" && (
          <>
            <h1 className="wb-hello">
              <span>{greeting()}</span>
              {first && !info.me.is_guest ? <>, {first}</> : null}
            </h1>
            <p className="wb-hello-sub hide-mobile">Start with a tool, or open a document. Drop files anywhere here to upload them.</p>
            <div className="wb-quick">
              {QUICK.map((q) => (
                <button key={q.key} className="wb-qc" onClick={() => run(q.key)}>
                  <ToolArt act={act(q.key)} size={40} />
                  <b>{q.title}</b>
                  <span className="hide-mobile">{q.sub}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="wb-sec">
          <h2>{section === "home" ? "Recent documents" : "All documents"}</h2>
          {section === "home" && docs.length > 12 && (
            <button className="link-btn" onClick={() => setSection("documents")}>
              See all {docs.length}
            </button>
          )}
          <span className="grow" />
          <input className="input input-sm wb-filter" placeholder="Filter by name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Filter documents" />
          <div className="wb-seg hide-mobile" role="group" aria-label="View">
            <button className={view === "grid" ? "on" : ""} onClick={() => pickView("grid")} aria-label="Grid view" aria-pressed={view === "grid"}>
              <I.grid size={16} />
            </button>
            <button className={view === "list" ? "on" : ""} onClick={() => pickView("list")} aria-label="List view" aria-pressed={view === "list"}>
              <I.list size={16} />
            </button>
          </div>
        </div>
        {docs.length > 0 && (
          <div className="wb-chips">
            {chips.map(([k, label]) => (
              <button key={k} className={`wb-chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(filter === k ? "all" : k)}>
                {filter === k && <I.check size={14} />}
                {label}
              </button>
            ))}
          </div>
        )}
        {docs.length === 0 && (
          <div className="wb-empty">
            <div className="rb-empty-ico">
              <I.upload size={22} />
            </div>
            <h3>No documents yet</h3>
            <p>Upload PDFs, Office files or images, or drag them here. Every tool works on them.</p>
            <button className="btn btn-primary mt-12" onClick={() => showUpload()}>
              <I.upload size={14} /> Upload documents
            </button>
          </div>
        )}
        <div className={`wb-docs ${shownView}`}>
          {list.map((d) => (
            <div key={d.id} className="wb-card menu-wrap">
              <button className="wb-card-open" onClick={() => openDoc(d.id)} title={d.name}>
                {shownView === "grid" ? (
                  <span className="wb-thumb">
                    <DocThumb doc={d} />
                  </span>
                ) : (
                  <span className="wb-mini">
                    <DocThumb doc={d} />
                  </span>
                )}
                <span className="wb-cmeta">
                  <FileBadge type={d.sourceType} />
                  <span className="wb-ctext">
                    <span className="wb-cname">{d.name}</span>
                    {sub(d)}
                  </span>
                </span>
              </button>
              {actions(d)}
            </div>
          ))}
        </div>
        {docs.length > 0 && shown.length === 0 && <div className="empty small">No documents match.</div>}
        <p className="wb-kb hide-mobile">
          Knowledge base: <b>{info.stats.docs}</b> docs · <b>{info.stats.pages}</b> pages, searchable across every upload
          {mine > 0 && <> · {mine} checked out by you</>}
        </p>
      </section>

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
    </>
  );
}

export function RenameModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
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

export function TagModal({ doc, onClose, suggestions }: { doc: Doc; onClose: () => void; suggestions: string[] }) {
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
