"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { CLIENT_KINDS } from "@/lib/client-shared";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { I } from "../icons";

export type ClientFields = {
  kind: "individual" | "couple" | "business";
  name: string;
  email: string;
  phone: string;
  spouseName: string;
  spouseEmail: string;
  company: string;
  tags: string[];
  assignedTo: string | null;
  notes: string;
};

const BLANK: ClientFields = { kind: "individual", name: "", email: "", phone: "", spouseName: "", spouseEmail: "", company: "", tags: [], assignedTo: null, notes: "" };

export function useMembers(wid: string) {
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api<{ members: { id: string; name: string }[] }>(`/api/workspaces/${wid}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [wid]);
  return members;
}

/** Add a client, or edit one (with `client`). */
export function ClientFormModal({ wid, client, clientId, onClose, onSaved }: { wid: string; client?: Partial<ClientFields>; clientId?: string; onClose: () => void; onSaved: (id?: string) => void }) {
  const toast = useToast();
  const members = useMembers(wid);
  const [f, setF] = useState<ClientFields>({ ...BLANK, ...client });
  const [tagText, setTagText] = useState((client?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ClientFields>(k: K, v: ClientFields[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    try {
      const data = { ...f, tags: tagText.split(",").map((t) => t.trim()).filter(Boolean) };
      if (clientId) {
        await api(`/api/workspaces/${wid}/clients/${clientId}`, { method: "POST", json: { action: "update", client: data } });
        toast("Client updated.", "success");
        onSaved(clientId);
      } else {
        const r = await api<{ client: { id: string } }>(`/api/workspaces/${wid}/clients`, { method: "POST", json: data });
        toast(`${f.name} added.`, "success");
        onSaved(r.client.id);
      }
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const business = f.kind === "business";
  return (
    <Modal
      title={clientId ? "Edit client" : "Add a client"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.name.trim() || !f.email.trim()} onClick={save}>
            {busy ? "Saving…" : clientId ? "Save" : "Add client"}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="fa-segment" role="radiogroup" aria-label="Client type">
          {CLIENT_KINDS.map((k) => (
            <button key={k.key} type="button" role="radio" aria-checked={f.kind === k.key} className={f.kind === k.key ? "on" : ""} onClick={() => set("kind", k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="fa-grid2">
          <div className="field">
            <label htmlFor="cf-name">{business ? "Contact name" : "Full name"}</label>
            <input id="cf-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="cf-email">Email</label>
            <input id="cf-email" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          {business && (
            <div className="field">
              <label htmlFor="cf-company">Business name</label>
              <input id="cf-company" className="input" value={f.company} onChange={(e) => set("company", e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="cf-phone">Phone (optional)</label>
            <input id="cf-phone" className="input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          {f.kind === "couple" && (
            <>
              <div className="field">
                <label htmlFor="cf-sname">Spouse’s name</label>
                <input id="cf-sname" className="input" value={f.spouseName} onChange={(e) => set("spouseName", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cf-semail">Spouse’s email (optional)</label>
                <input id="cf-semail" className="input" type="email" value={f.spouseEmail} onChange={(e) => set("spouseEmail", e.target.value)} />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="cf-tags">Tags</label>
            <input id="cf-tags" className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="VIP, Onboarding, Bookkeeping" />
          </div>
          <div className="field">
            <label htmlFor="cf-assign">Assigned to</label>
            <select id="cf-assign" className="select" value={f.assignedTo ?? ""} onChange={(e) => set("assignedTo", e.target.value || null)}>
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cf-notes">Notes (only your team sees these)</label>
          <textarea id="cf-notes" className="textarea" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ---------- import from a spreadsheet ----------

const FIELDS: { key: keyof ClientFields | "skip"; label: string; match: RegExp }[] = [
  { key: "name", label: "Name", match: /^(full ?)?name|client|contact/i },
  { key: "email", label: "Email", match: /e-?mail/i },
  { key: "phone", label: "Phone", match: /phone|mobile|cell/i },
  { key: "company", label: "Business name", match: /company|business|entity|organi[sz]ation/i },
  { key: "spouseName", label: "Spouse's name", match: /spouse|partner/i },
  { key: "tags", label: "Tags", match: /tag|type|service|category|group/i },
  { key: "skip", label: "Don't import", match: /^$/ },
];

/** Splits CSV text (commas or tabs, quoted fields) into rows. */
function parseCsv(text: string): string[][] {
  const delim = (text.split("\n")[0].match(/\t/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export function ImportModal({ wid, onClose, onDone }: { wid: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<(keyof ClientFields | "skip")[]>([]);
  const [busy, setBusy] = useState(false);
  function load(text: string) {
    const r = parseCsv(text);
    if (r.length < 2) return toast("That file needs a header row and at least one client.", "error");
    setRows(r);
    const used = new Set<string>();
    setMap(
      r[0].map((h) => {
        const f = FIELDS.find((x) => x.key !== "skip" && !used.has(x.key) && x.match.test(h));
        if (f) used.add(f.key);
        return f?.key ?? "skip";
      }),
    );
  }
  const people = rows
    ? rows.slice(1).map((r) => {
        const o: Record<string, string> = {};
        map.forEach((k, i) => k !== "skip" && r[i] && (o[k] = o[k] ? `${o[k]} ${r[i]}` : r[i]));
        return o;
      })
    : [];
  const valid = people.filter((p) => p.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email ?? ""));
  async function run() {
    setBusy(true);
    try {
      const clients = valid.map((p) => ({
        kind: p.company ? "business" : p.spouseName ? "couple" : "individual",
        name: p.name,
        email: p.email,
        phone: p.phone ?? "",
        company: p.company ?? "",
        spouseName: p.spouseName ?? "",
        tags: (p.tags ?? "").split(/[;,|]/).map((t) => t.trim()).filter(Boolean),
      }));
      const r = await api<{ added: number; skipped: string[] }>(`/api/workspaces/${wid}/clients/import`, { method: "POST", json: { clients } });
      toast(`${r.added} client${r.added === 1 ? "" : "s"} added${r.skipped.length ? `; ${r.skipped.length} already existed` : ""}.`, "success");
      onDone();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Import clients"
      wide
      onClose={onClose}
      footer={
        rows && (
          <>
            <button className="btn" onClick={() => setRows(null)}>Choose another file</button>
            <button className="btn btn-primary" disabled={busy || !valid.length} onClick={run}>
              {busy ? "Importing…" : `Import ${valid.length} client${valid.length === 1 ? "" : "s"}`}
            </button>
          </>
        )
      }
    >
      {!rows ? (
        <div className="col gap-12">
          <p className="muted" style={{ margin: 0 }}>
            Export your client list as CSV from Excel, Google Sheets, QuickBooks or your tax software. It needs at least a name and an email column.
          </p>
          <label className="fa-drop">
            <I.upload size={22} />
            <b>Choose a CSV file</b>
            <span className="small muted">or paste the rows below</span>
            <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={async (e) => e.target.files?.[0] && load(await e.target.files[0].text())} />
          </label>
          <textarea className="textarea" rows={5} placeholder={"Name,Email,Phone,Tags\nMaria Lopez,maria@example.com,312-555-0100,1040"} onBlur={(e) => e.target.value.trim() && load(e.target.value)} />
        </div>
      ) : (
        <div className="col gap-12">
          <p className="muted" style={{ margin: 0 }}>Check which column is which. {people.length - valid.length > 0 && `${people.length - valid.length} row(s) without a name or valid email will be skipped.`}</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {rows[0].map((h, i) => (
                    <th key={i}>
                      <div className="small faint">{h}</div>
                      <select className="select input-sm" value={map[i]} onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? (e.target.value as keyof ClientFields) : x)))}>
                        {FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1, 6).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className="ellipsis" style={{ maxWidth: 180 }}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 6 && <span className="small faint">…and {rows.length - 6} more rows</span>}
        </div>
      )}
    </Modal>
  );
}
