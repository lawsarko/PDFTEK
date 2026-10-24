"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { AppShell } from "@/components/app-shell";
import { I } from "@/components/icons";
import { Modal } from "@/components/modal";
import { ConvertToPdfModal } from "@/components/convert-to-pdf";
import { ToolModal, UnlockModal, UploadButton, type ToolKey } from "@/components/tools/tool-modals";


const TOOLS: { key: ToolKey | "unlock" | "topdf" | "images" | "scan" | "convert" | "ocr" | "compare" | "fill" | "statement" | "invoice" | "bulk" | "request"; title: string; desc: string; icon: React.ReactNode }[] = [
  { key: "fill", title: "Fill a form", desc: "AI finds every field, fills it from your profile, and you sign. Works on scans.", icon: <I.form size={18} /> },
  { key: "statement", title: "Bank statement → Excel", desc: "Clean transaction rows from any bank's PDF statement, checked against the balances.", icon: <I.table size={18} /> },
  { key: "invoice", title: "Invoices → Excel", desc: "Vendor, dates, line items, tax and totals from invoices and receipts.", icon: <I.file size={18} /> },
  { key: "request", title: "Request documents", desc: "Send a checklist and collect files through a secure, code-protected link. Day Pass, Pro or Team.", icon: <I.inbox size={18} /> },
  { key: "bulk", title: "Bulk convert", desc: "Many PDFs to Word or Excel at once, downloaded as one ZIP. Day Pass, Pro or Team.", icon: <I.layers size={18} /> },
  { key: "topdf", title: "Convert to PDF", desc: "Word, Excel, PowerPoint, text and images to PDF.", icon: <I.file size={18} /> },
  { key: "convert", title: "Convert PDF", desc: "To Word, Excel, PowerPoint, JPG, PNG, WEBP, TIFF.", icon: <I.convert size={18} /> },
  { key: "merge", title: "Merge PDFs", desc: "Combine several documents into one, in any order.", icon: <I.merge size={18} /> },
  { key: "split", title: "Split PDF", desc: "Break a document into parts by page ranges.", icon: <I.split size={18} /> },
  { key: "organize", title: "Organize pages", desc: "Drag to reorder, rotate or delete pages visually.", icon: <I.layers size={18} /> },
  { key: "extract", title: "Extract pages", desc: "Copy selected pages into a new document.", icon: <I.file size={18} /> },
  { key: "delete_pages", title: "Delete pages", desc: "Remove pages and save a new version.", icon: <I.trash size={18} /> },
  { key: "rotate", title: "Rotate pages", desc: "Fix sideways scans by 90°, 180° or 270°.", icon: <I.rotate size={18} /> },
  { key: "watermark", title: "Watermark", desc: "Stamp DRAFT, CONFIDENTIAL or any text diagonally.", icon: <I.drop size={18} /> },
  { key: "page_numbers", title: "Page numbers", desc: "Add “Page n of N” or Bates-style numbering.", icon: <I.hash size={18} /> },
  { key: "optimize", title: "Compress PDF", desc: "Shrink the file by resizing and recompressing images.", icon: <I.zoomOut size={18} /> },
  { key: "protect", title: "Protect PDF", desc: "Add a password (AES-256) and control printing and copying.", icon: <I.lock size={18} /> },
  { key: "unlock", title: "Unlock PDF", desc: "Remove the password from a PDF you can open.", icon: <I.unlock size={18} /> },
  { key: "metadata", title: "Edit properties", desc: "Set title, author and subject metadata.", icon: <I.tag size={18} /> },
  { key: "images", title: "JPG/PNG → PDF", desc: "Combine images into a single PDF.", icon: <I.image size={18} /> },
  { key: "scan", title: "Scan to PDF", desc: "Use your camera with auto-crop and enhance.", icon: <I.camera size={18} /> },
  { key: "ocr", title: "OCR", desc: "Make scanned documents searchable in 13 languages.", icon: <I.scan size={18} /> },
  { key: "compare", title: "Compare", desc: "Redline two documents or versions, with an AI summary.", icon: <I.compare size={18} /> },
];

const NON_MODAL = ["unlock", "topdf", "images", "scan", "convert", "ocr", "compare", "pick", "fill", "statement", "invoice", "bulk"];

const PICK_TASKS: Record<string, { title: string; hint: string }> = {
  fill: { title: "Fill a form", hint: "Pick or upload the form to fill: fillable PDFs, flat PDFs and scans all work." },
  edit: { title: "Edit a PDF", hint: "Pick the document to edit. You can change text, add images, highlight and redact." },
  sign: { title: "Request signatures", hint: "Pick the document people need to sign." },
  ask: { title: "Ask AI about a document", hint: "Pick a document and ask anything. Every answer cites its page." },
  read: { title: "Read aloud", hint: "Pick a document to listen to. Choose the voice, language and speed in the player." },
  ocr: { title: "Make a scan searchable", hint: "Pick a scanned PDF to run OCR on." },
  "convert-docx": { title: "PDF to Word", hint: "Pick or upload the PDF to convert to an editable Word document." },
  "convert-xlsx": { title: "PDF to Excel", hint: "Pick or upload the PDF to convert to an Excel workbook." },
  "convert-pptx": { title: "PDF to PowerPoint", hint: "Pick or upload the PDF to turn into slides." },
  "convert-jpg": { title: "PDF to JPG", hint: "Pick or upload the PDF to export as images." },
};

/** "Which document?" step for tasks that start from a single PDF (edit, sign, convert from PDF…). */
function PickDocModal({ wid, task, docs, onUploaded, onClose }: { wid: string; task: string; docs: Doc[]; onUploaded: (d: Doc[]) => void; onClose: () => void }) {
  const router = useRouter();
  const t = PICK_TASKS[task] ?? { title: "Choose a document", hint: "Pick a document from your library or upload one." };
  const go = (id: string) =>
    router.push(task === "sign" ? `/app/${wid}/send/${id}` : task === "fill" ? `/app/${wid}/fill/${id}` : `/app/${wid}?doc=${id}&do=${task}`);
  return (
    <Modal title={t.title} onClose={onClose}>
      <div className="col gap-12">
        <p className="small muted" style={{ margin: 0 }}>{docs.length ? "Choose one of your documents, or upload a new one." : t.hint}</p>
        {docs.length > 0 && (
          <div className="col gap-4" style={{ maxHeight: 340, overflowY: "auto" }}>
            {docs.map((d) => (
              <button key={d.id} className="menu-item" style={{ border: "1px solid var(--line)" }} onClick={() => go(d.id)}>
                <I.file size={14} />
                <span className="grow ellipsis">{d.name}</span>
                <span className="tiny faint mono">{d.pageCount} p</span>
                <I.right size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <UploadButton
            wid={wid}
            label={docs.length ? "Upload a different file" : "Upload a file"}
            onDone={(d) => {
              onUploaded(d);
              go(d[0].id);
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

export function Tools({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [docs, setDocs] = useState<Doc[]>([]);
  const initial = params.get("tool");
  const [open, setOpen] = useState<ToolKey | null>(() => (TOOLS.some((t) => t.key === initial) && !NON_MODAL.includes(initial!) ? (initial as ToolKey) : null));
  const preselect = params.get("doc");
  const [toPdf, setToPdf] = useState(initial === "topdf");
  const [unlock, setUnlock] = useState(initial === "unlock");
  const [pick, setPick] = useState<string | null>(initial === "pick" ? params.get("do") : null);
  const addDocs = (d: Doc[]) => setDocs((cur) => [...d, ...cur.filter((x) => !d.some((n) => n.id === x.id))]);

  useEffect(() => {
    api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`).then((r) => setDocs(r.documents));
  }, [wid]);

  const click = (k: (typeof TOOLS)[number]["key"]) => {
    if (k === "topdf") setToPdf(true);
    else if (k === "unlock") setUnlock(true);
    else if (k === "images" || k === "scan") router.push(`/app/${wid}?add=${k}`);
    else if (k === "convert" || k === "ocr") router.push(`/app/${wid}${preselect ? `?doc=${preselect}` : ""}`);
    else if (k === "fill") setPick("fill");
    else if (k === "statement" || k === "invoice" || k === "bulk") router.push(`/app/${wid}/to-excel?kind=${k}${preselect ? `&doc=${preselect}` : ""}`);
    else if (k === "request") router.push(`/app/${wid}/requests?new=1`);
    else if (k === "compare") router.push(`/app/${wid}/compare${preselect ? `?a=${preselect}` : ""}`);
    else setOpen(k);
  };

  return (
    <AppShell wid={wid} title="PDF tools">
      <div className="shell">
        <h1>PDF tools</h1>
        <p className="muted">Every tool works on documents in your workspace. Changes to an existing document are saved as a new version, so nothing is ever lost.</p>
        <div className="tool-grid mt-24">
          {TOOLS.map((t) => (
            <button key={t.key} className="tool-card" onClick={() => click(t.key)}>
              <div className="ico">{t.icon}</div>
              <h3>{t.title}</h3>
              <p>{t.desc}</p>
            </button>
          ))}
        </div>
      </div>
      {pick && <PickDocModal wid={wid} task={pick} docs={docs} onUploaded={addDocs} onClose={() => setPick(null)} />}
      {unlock && <UnlockModal wid={wid} onUploaded={addDocs} onClose={() => setUnlock(false)} />}
      {toPdf && <ConvertToPdfModal wid={wid} onClose={() => setToPdf(false)} />}
      {open && <ToolModal wid={wid} tool={open} docs={docs} onUploaded={addDocs} preselect={preselect} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

