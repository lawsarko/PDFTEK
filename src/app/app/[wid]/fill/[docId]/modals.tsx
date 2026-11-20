"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { SignaturePad } from "@/components/signature-pad";
import { I } from "@/components/icons";
import { api, download, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { PROFILE_FIELDS, profileValue, slug, toIsoDate, type FormField, type FormValues, type Profile } from "@/lib/forms";

// ---------- signature ----------

export function SignModal({
  kind,
  name,
  saved,
  canSave,
  count,
  onDone,
  onClose,
}: {
  kind: "signature" | "initials";
  name: string;
  saved: string | null;
  canSave: boolean;
  /** Other empty fields of the same kind on the form. */
  count: number;
  onDone: (png: string, opts: { save: boolean; all: boolean }) => void;
  onClose: () => void;
}) {
  const [png, setPng] = useState<string | null>(null);
  const [save, setSave] = useState(canSave && !saved);
  const [all, setAll] = useState(true);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <Modal
      title={kind === "initials" ? "Add your initials" : "Add your signature"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!png} onClick={() => png && onDone(png, { save, all })}>
            <I.check size={14} /> Use it
          </button>
        </>
      }
    >
      <div className="col gap-12">
        {saved && (
          <button className="ff-saved-sig" onClick={() => onDone(saved, { save: false, all })}>
            <img src={saved} alt="Saved signature" />
            <span className="small">Use my saved {kind}</span>
          </button>
        )}
        <SignaturePad name={kind === "initials" ? initials : name} onChange={setPng} height={kind === "initials" ? 110 : 150} />
        {canSave && (
          <label className="check">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save to my profile for next time
          </label>
        )}
        {count > 0 && (
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Also use it in the other {count} {kind} field{count === 1 ? "" : "s"}
          </label>
        )}
        <p className="tiny faint" style={{ margin: 0 }}>By signing you agree this electronic signature is the legal equivalent of your handwritten one for this document.</p>
      </div>
    </Modal>
  );
}

// ---------- save ----------

export function SaveModal({
  docName,
  missing,
  problems,
  busy,
  result,
  wid,
  onSave,
  onClose,
}: {
  docName: string;
  missing: FormField[];
  problems: FormField[];
  busy: boolean;
  result: Doc | null;
  wid: string;
  onSave: (opts: { name: string; flatten: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(docName.replace(/\.pdf$/i, ""));
  const [flatten, setFlatten] = useState(true);
  const [downloading, setDownloading] = useState(false);

  if (result) {
    const get = async () => {
      setDownloading(true);
      try {
        const blob = await api<Blob>(`/api/documents/${result.id}/file?download=1`);
        download(blob, result.name);
      } finally {
        setDownloading(false);
      }
    };
    return (
      <Modal title="Your form is ready" onClose={onClose}>
        <div className="col gap-12" style={{ textAlign: "center", alignItems: "center" }}>
          <div className="ff-done-icon"><I.check size={28} /></div>
          <p className="muted" style={{ margin: 0 }}>
            <b>{result.name}</b> is saved in your library. The blank form stays as it was, ready to fill again.
          </p>
          <div className="row wrap gap-8" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={get} disabled={downloading}>
              {downloading ? <span className="spinner" /> : <I.download size={14} />} Download PDF
            </button>
            <Link className="btn" href={`/app/${wid}/send/${result.id}`}>
              <I.sign size={14} /> Send for signature
            </Link>
            <Link className="btn btn-ghost" href={`/app/${wid}?doc=${result.id}`}>
              Open in workbench
            </Link>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Save the filled form"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Keep filling</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => onSave({ name: name.trim(), flatten })}>
            {busy ? <span className="spinner" /> : <I.check size={14} />} Save filled copy
          </button>
        </>
      }
    >
      <div className="col gap-12">
        {missing.length > 0 && (
          <div className="notice">
            <b>{missing.length} required field{missing.length === 1 ? " is" : "s are"} empty:</b> {missing.slice(0, 4).map((f) => f.label).join(", ")}
            {missing.length > 4 ? "…" : ""}. You can still save.
          </div>
        )}
        {problems.length > 0 && (
          <div className="notice">
            <b>Worth a second look:</b> {problems.slice(0, 4).map((f) => f.label).join(", ")}
            {problems.length > 4 ? "…" : ""}
          </div>
        )}
        <div className="field">
          <label>File name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="tiny faint">Saved as “{name || "form"} (filled).pdf”</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
          <span>
            Lock the answers <span className="tiny faint">(recommended when sending it off; untick to keep it editable)</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

// ---------- learning new answers ----------

export type Learn = { key: string; label: string; value: string; shown: string; custom: boolean; checked: boolean };

/** Answers on this form that the profile doesn't have yet (sensitive fields never qualify). */
export function learnable(fields: FormField[], values: FormValues, profile: Profile | null): Learn[] {
  const out: Learn[] = [];
  const seen = new Set<string>();
  const stored = new Set(PROFILE_FIELDS.map((f) => f.key));
  for (const f of fields) {
    const v = values[f.id];
    if (!v?.value.trim() || f.sensitive || v.source === "profile") continue;
    if (["signature", "initials", "checkbox", "radio"].includes(f.type)) continue;
    if (f.profileKey && stored.has(f.profileKey)) {
      if (seen.has(f.profileKey)) continue;
      const raw = f.type === "date" ? (toIsoDate(v.value) ?? v.value) : v.value.trim();
      const cur = profile?.data.values[f.profileKey] ?? "";
      if (cur.trim() === raw || profileValue(f.profileKey, profile?.data, f) === v.value.trim()) continue;
      seen.add(f.profileKey);
      out.push({ key: f.profileKey, label: PROFILE_FIELDS.find((p) => p.key === f.profileKey)!.label, value: raw, shown: v.value.trim(), custom: false, checked: true });
    } else if (!f.profileKey && v.source === "you" && f.label.length < 80) {
      const k = `custom:${slug(f.label)}`;
      if (seen.has(k) || profile?.data.custom.some((c) => slug(c.label) === slug(f.label) && c.value === v.value)) continue;
      seen.add(k);
      out.push({ key: k, label: f.label, value: v.value.trim(), shown: v.value.trim(), custom: true, checked: false });
    }
  }
  return out;
}

export function LearnModal({ items, profileName, onSave, onClose }: { items: Learn[]; profileName: string; onSave: (items: Learn[]) => void; onClose: () => void }) {
  const [list, setList] = useState(items);
  return (
    <Modal
      title={`Remember these for next time?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Not now</button>
          <button className="btn btn-primary" disabled={!list.some((l) => l.checked)} onClick={() => onSave(list.filter((l) => l.checked))}>
            Save to {profileName}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>Saved answers fill in automatically on your next form.</p>
      <div className="col gap-8">
        {list.map((l, i) => (
          <label key={l.key} className="check ff-learn">
            <input type="checkbox" checked={l.checked} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
            <span className="grow">
              <span className="tiny faint">{l.label}</span>
              <br />
              {l.shown}
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ---------- batch fill from a spreadsheet ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function BulkModal({ docId, docName, fields, values, signatures, onClose }: { docId: string; docName: string; fields: FormField[]; values: FormValues; signatures: Record<string, string>; onClose: () => void }) {
  const fillable = fields.filter((f) => !["signature", "initials"].includes(f.type) && !f.readOnly);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [nameColumn, setNameColumn] = useState("");
  const [useCurrent, setUseCurrent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo(() => {
    const used = new Map<string, number>();
    return fillable.map((f) => {
      const base = f.label.replace(/[",\n]/g, " ").trim() || f.id;
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      return n > 1 ? `${base} (${n})` : base;
    });
  }, [fillable]);

  const template = () => {
    const csv = headers.map((h) => `"${h}"`).join(",") + "\n";
    download(new Blob([csv], { type: "text/csv" }), `${docName.replace(/\.pdf$/i, "")} - template.csv`);
  };

  const load = async (file: File) => {
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });
      if (!data.length) throw new Error("The first sheet has no rows.");
      const cols = Object.keys(data[0]);
      setRows(data.slice(0, 500).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))));
      setColumns(cols);
      // Match columns to fields by name (exact, then contained).
      const m: Record<string, string> = {};
      fillable.forEach((f, i) => {
        const targets = [norm(headers[i]), norm(f.label)];
        const col = cols.find((c) => targets.includes(norm(c))) ?? cols.find((c) => norm(c).length > 2 && targets.some((t) => t.includes(norm(c)) || norm(c).includes(t)));
        if (col) m[f.id] = col;
      });
      setMapping(m);
      setNameColumn(cols.find((c) => /name/i.test(c)) ?? "");
      if (data.length > 500) setError("Only the first 500 rows will be used.");
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const run = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const constants = useCurrent ? Object.fromEntries(Object.entries(values).filter(([id]) => !mapping[id])) : {};
      const blob = await api<Blob>(`/api/documents/${docId}/form/bulk`, {
        method: "POST",
        json: { rows, mapping, constants, signatures, nameColumn: nameColumn || undefined, flatten: true },
      });
      download(blob, `${docName.replace(/\.pdf$/i, "")} - ${rows.length} filled.zip`);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const mapped = Object.values(mapping).filter(Boolean).length;
  return (
    <Modal
      title="Fill many copies from a spreadsheet"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!rows || !mapped || busy} onClick={run}>
            {busy ? <span className="spinner" /> : <I.download size={14} />} Create {rows?.length ?? 0} PDFs (.zip)
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p className="small muted" style={{ margin: 0 }}>
          One row per person or record (employees, students, clients…). Each row becomes its own filled PDF. Day Pass or Pro.
        </p>
        <div className="row wrap gap-8">
          <label className="btn">
            <I.upload size={14} /> Choose CSV or Excel file
            <input type="file" accept=".csv,.xlsx,.xls,.ods" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </label>
          <button className="btn btn-ghost" onClick={template}>
            <I.table size={14} /> Download a template with this form&apos;s fields
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
        {rows && (
          <>
            <div className="small">
              <b>{rows.length}</b> rows · <b>{mapped}</b> of {fillable.length} fields matched to a column
            </div>
            <div className="ff-map">
              {fillable.map((f) => (
                <div key={f.id} className="row gap-8">
                  <span className="small grow ellipsis" title={f.label}>{f.label}</span>
                  <select className="input input-sm" style={{ width: 200 }} value={mapping[f.id] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.id]: e.target.value })}>
                    <option value="">{useCurrent && values[f.id]?.value ? `Same for all: ${values[f.id].value.slice(0, 18)}` : "Leave empty"}</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="row wrap gap-12">
              <label className="small row gap-8">
                Name each file by
                <select className="input input-sm" value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
                  <option value="">Row number</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check small">
                <input type="checkbox" checked={useCurrent} onChange={(e) => setUseCurrent(e.target.checked)} /> Use my current answers (and signatures) for fields without a column
              </label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
