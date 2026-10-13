"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/icons";
import {
  PROFILE_FIELDS,
  PROFILE_KEY_LABELS,
  isAnswered,
  validate,
  type FieldValue,
  type FormField,
  type FormSummary,
  type FormValues,
  type Profile,
  type ProfileData,
} from "@/lib/forms";
import type { Doc } from "@/lib/client/types";

// ---------- one answer ----------

export function FieldInput({
  field,
  value,
  signature,
  onChange,
  onSign,
  big,
  autoFocus,
  onEnter,
}: {
  field: FormField;
  value: FieldValue | undefined;
  signature?: string;
  onChange: (v: string) => void;
  onSign: () => void;
  big?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const v = value?.value ?? "";
  const cls = `input ${big ? "input-lg" : "input-sm"}`;
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };
  switch (field.type) {
    case "checkbox": {
      const on = /^(true|yes|on|1|x|✓|checked)$/i.test(v);
      return (
        <button type="button" className={`ff-toggle ${on ? "on" : ""} ${big ? "big" : ""}`} onClick={() => onChange(on ? "false" : "true")} autoFocus={autoFocus} onKeyDown={key}>
          <span className="ff-toggle-box">{on && <I.check size={big ? 16 : 12} />}</span>
          {on ? "Yes, ticked" : "Not ticked"}
        </button>
      );
    }
    case "radio":
    case "choice": {
      const opts = field.options ?? [];
      if (opts.length && opts.length <= 5 && big) {
        return (
          <div className="ff-seg">
            {opts.map((o, i) => (
              <button type="button" key={o.value} autoFocus={autoFocus && i === 0} className={v === o.value ? "on" : ""} onClick={() => onChange(v === o.value ? "" : o.value)} onKeyDown={key}>
                {o.label || o.value}
              </button>
            ))}
          </div>
        );
      }
      return (
        <select className={cls} value={v} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} onKeyDown={key}>
          <option value="">Choose…</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label || o.value}
            </option>
          ))}
        </select>
      );
    }
    case "signature":
    case "initials":
      return (
        <button type="button" className={`ff-sign-btn ${signature ? "signed" : ""} ${big ? "big" : ""}`} onClick={onSign} autoFocus={autoFocus}>
          {signature ? <img src={signature} alt="Your signature" /> : <><I.sign size={14} /> {field.type === "initials" ? "Add initials" : "Add signature"}</>}
        </button>
      );
    case "multiline":
      return <textarea className={`textarea ${big ? "" : "textarea-sm"}`} rows={big ? 5 : 3} value={v} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />;
    default:
      return (
        <input
          className={cls}
          value={v}
          maxLength={field.maxLength}
          placeholder={field.type === "date" ? (field.format ?? "MM/DD/YYYY") : ""}
          inputMode={field.type === "number" ? "decimal" : field.type === "phone" ? "tel" : field.type === "email" ? "email" : undefined}
          type={field.sensitive ? "text" : undefined}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          onKeyDown={key}
        />
      );
  }
}

export function SourceChip({ value, field }: { value: FieldValue | undefined; field: FormField }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {field.sensitive && (
        <span className="ff-chip ff-chip-lock" title="Sensitive: used for this form only, never saved to your profile or drafts">
          <I.lock size={10} /> Not saved
        </span>
      )}
      {value?.value && value.source === "profile" && <span className="ff-chip ff-chip-profile">Profile</span>}
      {value?.value && value.source === "document" && <span className="ff-chip ff-chip-doc">From document</span>}
      {value?.value && value.source === "ai" && (
        <span className={`ff-chip ${(value.confidence ?? 1) < 0.75 ? "ff-chip-low" : "ff-chip-ai"}`} title={value.note}>
          <I.sparkle size={10} /> AI {value.confidence !== undefined ? `${Math.round(value.confidence * 100)}%` : ""}
        </span>
      )}
    </span>
  );
}

// ---------- the list of fields ----------

export type Filter = "all" | "todo" | "check";

export function needsCheck(f: FormField, v: FieldValue | undefined) {
  return Boolean(v?.value && (validate(f, v.value) || (v.source === "ai" && (v.confidence ?? 1) < 0.75)));
}

export function FieldsList({
  fields,
  values,
  signatures,
  selected,
  filter,
  onFilter,
  onSelect,
  onChange,
  onSign,
  onLabel,
}: {
  fields: FormField[];
  values: FormValues;
  signatures: Record<string, string>;
  selected: string | null;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onSelect: (id: string) => void;
  onChange: (id: string, v: string) => void;
  onSign: (id: string) => void;
  onLabel?: (id: string, label: string) => void;
}) {
  const [helpOpen, setHelpOpen] = useState<string | null>(null);
  const shown = fields.filter((f) =>
    filter === "todo" ? !isAnsweredOrSigned(f, values[f.id], signatures) : filter === "check" ? needsCheck(f, values[f.id]) : true,
  );
  const sections: { name: string; fields: FormField[] }[] = [];
  for (const f of shown) {
    const name = f.section || "";
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else sections.push({ name, fields: [f] });
  }
  const counts = {
    todo: fields.filter((f) => !isAnsweredOrSigned(f, values[f.id], signatures)).length,
    check: fields.filter((f) => needsCheck(f, values[f.id])).length,
  };
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-field="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <div className="row gap-4 ff-filters">
        {(["all", "todo", "check"] as Filter[]).map((k) => (
          <button key={k} className={`chip ${filter === k ? "active" : ""}`} onClick={() => onFilter(k)}>
            {k === "all" ? `All ${fields.length}` : k === "todo" ? `To do ${counts.todo}` : `Check ${counts.check}`}
          </button>
        ))}
      </div>
      <div className="ff-list" ref={listRef}>
        {!shown.length && <div className="empty small">{filter === "todo" ? "Everything is answered. 🎉" : filter === "check" ? "Nothing needs checking." : "No fields yet."}</div>}
        {sections.map((s, si) => (
          <div key={`${s.name}-${si}`}>
            {s.name && <div className="ff-section">{s.name}</div>}
            {s.fields.map((f) => {
              const v = values[f.id];
              const err = v?.value ? validate(f, v.value) : null;
              return (
                <div key={f.id} data-field={f.id} className={`ff-row ${selected === f.id ? "sel" : ""}`} onClick={() => onSelect(f.id)}>
                  <div className="row between" style={{ gap: 6 }}>
                    <label className="ff-row-label">
                      {onLabel ? (
                        <input className="ff-label-edit" value={f.label} onChange={(e) => onLabel(f.id, e.target.value)} />
                      ) : (
                        f.label
                      )}
                      {f.required && <span className="ff-reqmark">*</span>}
                    </label>
                    <span className="row" style={{ gap: 4, flex: "none" }}>
                      <SourceChip value={v} field={f} />
                      {f.help && (
                        <button className="icon-btn" aria-label="What does this mean?" onClick={(e) => { e.stopPropagation(); setHelpOpen(helpOpen === f.id ? null : f.id); }}>
                          <I.info size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                  {helpOpen === f.id && f.help && <div className="ff-help">{f.help}</div>}
                  {!onLabel && (
                    <div className="mt-4" onClick={(e) => e.stopPropagation()} onFocus={() => onSelect(f.id)}>
                      <FieldInput field={f} value={v} signature={signatures[f.id]} onChange={(val) => onChange(f.id, val)} onSign={() => onSign(f.id)} />
                    </div>
                  )}
                  {err && <div className="ff-error">{err}</div>}
                  {v?.note && v.source === "ai" && <div className="ff-note">{v.note}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function isAnsweredOrSigned(f: FormField, v: FieldValue | undefined, signatures: Record<string, string>) {
  if (f.type === "signature" || f.type === "initials") return Boolean(signatures[f.id]);
  return isAnswered(f, v);
}

// ---------- guided mode: one question at a time ----------

export function Guided({
  fields,
  values,
  signatures,
  index,
  setIndex,
  onChange,
  onSign,
  onFinish,
}: {
  fields: FormField[];
  values: FormValues;
  signatures: Record<string, string>;
  index: number;
  setIndex: (i: number) => void;
  onChange: (id: string, v: string) => void;
  onSign: (id: string) => void;
  onFinish: () => void;
}) {
  const f = fields[index];
  if (!f) {
    return (
      <div className="ff-guided ff-done">
        <div className="ff-done-icon"><I.check size={28} /></div>
        <h3>That&apos;s every question.</h3>
        <p className="muted small">Review the form, then save your filled copy.</p>
        <button className="btn btn-primary btn-lg" onClick={onFinish}>Review &amp; save</button>
        <button className="btn btn-ghost" onClick={() => setIndex(0)}>Start over</button>
      </div>
    );
  }
  const v = values[f.id];
  const err = v?.value ? validate(f, v.value) : null;
  const next = () => setIndex(Math.min(fields.length, index + 1));
  return (
    <div className="ff-guided">
      <div className="ff-guided-top">
        <span className="tiny muted">Question {index + 1} of {fields.length}</span>
        <div className="ff-progress"><span style={{ width: `${((index + 1) / fields.length) * 100}%` }} /></div>
      </div>
      {f.section && <div className="eyebrow">{f.section}</div>}
      <h3 className="ff-q">
        {f.label}
        {f.required && <span className="ff-reqmark">*</span>}
      </h3>
      {f.help && <p className="ff-q-help">{f.help}</p>}
      <div className="row" style={{ gap: 6 }}><SourceChip value={v} field={f} /></div>
      <div className="mt-12" key={f.id}>
        <FieldInput field={f} value={v} signature={signatures[f.id]} onChange={(val) => onChange(f.id, val)} onSign={() => onSign(f.id)} big autoFocus onEnter={next} />
      </div>
      {err && <div className="ff-error">{err}</div>}
      {v?.note && v.source === "ai" && <div className="ff-note">{v.note}</div>}
      <div className="row between mt-16">
        <button className="btn btn-ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <I.left size={14} /> Back
        </button>
        <button className="btn btn-primary" onClick={next}>
          {isAnsweredOrSigned(f, v, signatures) ? "Next" : "Skip"} <I.right size={14} />
        </button>
      </div>
      <p className="tiny faint mt-8">Press Enter for the next question.</p>
    </div>
  );
}

// ---------- AI assistant ----------

export function Assistant({
  summary,
  docs,
  sourceIds,
  setSourceIds,
  instructions,
  setInstructions,
  questions,
  busy,
  aiAvailable,
  freeForm,
  onFill,
}: {
  summary: FormSummary | null;
  docs: Doc[] | null;
  sourceIds: string[];
  setSourceIds: (ids: string[]) => void;
  instructions: string;
  setInstructions: (s: string) => void;
  questions: string[];
  busy: boolean;
  aiAvailable: boolean;
  freeForm: boolean;
  onFill: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const addAnswers = () => {
    const text = questions.map((q, i) => (answers[i]?.trim() ? `${q} ${answers[i].trim()}` : "")).filter(Boolean).join("\n");
    if (text) setInstructions(`${instructions.trim() ? `${instructions.trim()}\n` : ""}${text}`);
    setAnswers({});
  };
  return (
    <div className="ff-assistant">
      {summary && (
        <div className="ff-summary">
          <div className="eyebrow">About this form</div>
          <h4>{summary.title}</h4>
          <p>{summary.purpose}</p>
          {summary.whoFills && <p><b>Who fills it:</b> {summary.whoFills}</p>}
          {summary.submitTo && <p><b>Send it to:</b> {summary.submitTo}</p>}
          {summary.deadline && <p><b>Deadline:</b> {summary.deadline}</p>}
          {summary.tips?.length ? (
            <ul>
              {summary.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className="field">
        <label>Tell AI anything that helps</label>
        <textarea
          className="textarea"
          rows={4}
          placeholder="e.g. Moving in March 1, unit 4B, rent $1,850. One cat. My employer is Acme since 2021."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Read answers from my documents (up to 5)</label>
        {!docs ? (
          <span className="spinner" />
        ) : !docs.length ? (
          <span className="tiny faint">Upload an ID, a pay stub or a previous application and AI can copy details from it.</span>
        ) : (
          <div className="ff-docs">
            {docs.slice(0, 60).map((d) => (
              <label key={d.id} className="check">
                <input
                  type="checkbox"
                  checked={sourceIds.includes(d.id)}
                  disabled={!sourceIds.includes(d.id) && sourceIds.length >= 5}
                  onChange={(e) => setSourceIds(e.target.checked ? [...sourceIds, d.id] : sourceIds.filter((x) => x !== d.id))}
                />
                <span className="ellipsis">{d.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-primary btn-lg ff-ai-btn" disabled={busy || !aiAvailable} onClick={onFill}>
        {busy ? <span className="spinner" /> : <I.sparkle size={16} />} {busy ? "Filling…" : "Fill with AI"}
      </button>
      <p className="tiny faint" style={{ textAlign: "center", margin: 0 }}>
        {!aiAvailable ? "AI isn't set up on this server." : freeForm ? "Free for your first form this month." : "Uses AI credits for what it costs, usually a few credits per form."} Answers you typed are never replaced.
      </p>
      {questions.length > 0 && (
        <div className="ff-questions">
          <div className="eyebrow">AI needs a few details</div>
          {questions.map((q, i) => (
            <div key={q} className="field">
              <label>{q}</label>
              <input className="input input-sm" value={answers[i] ?? ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} />
            </div>
          ))}
          <button className="btn btn-sm" onClick={() => { addAnswers(); setTimeout(onFill, 0); }} disabled={busy}>
            <I.sparkle size={12} /> Add answers &amp; fill again
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- profile editor ----------

export function ProfileEditor({
  profiles,
  profileId,
  onSwitch,
  onCreate,
  onSave,
  onDelete,
  onSignature,
}: {
  profiles: Profile[];
  profileId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string, kind: "person" | "business") => void;
  onSave: (p: Profile) => Promise<void>;
  onDelete: (id: string) => void;
  onSignature: (kind: "signature" | "initials") => void;
}) {
  const current = profiles.find((p) => p.id === profileId) ?? null;
  const [draft, setDraft] = useState<Profile | null>(current);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  useEffect(() => {
    setDraft(current);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, current?.updatedAt]);

  const sections = useMemo(() => {
    const kind = draft?.kind ?? "person";
    const map = new Map<string, typeof PROFILE_FIELDS>();
    for (const f of PROFILE_FIELDS) {
      if (kind === "business" ? f.kind !== "business" && !["email", "phone"].includes(f.key) : f.kind === "business") continue;
      map.set(f.section, [...(map.get(f.section) ?? []), f]);
    }
    return [...map.entries()];
  }, [draft?.kind]);

  const set = (patch: Partial<ProfileData>) => {
    if (!draft) return;
    setDraft({ ...draft, data: { ...draft.data, ...patch } });
    setDirty(true);
  };

  if (!current || !draft) {
    return (
      <div className="ff-assistant">
        <div className="ff-summary">
          <h4>Fill forms in seconds</h4>
          <p>Save your details once: name, address, contact, work. Every form after that fills itself. Sensitive numbers like SSNs are never saved.</p>
        </div>
        <button className="btn btn-primary" onClick={() => onCreate("Me", "person")}>
          <I.user size={14} /> Create my profile
        </button>
        <button className="btn" onClick={() => onCreate("My business", "business")}>Create a business profile</button>
      </div>
    );
  }

  return (
    <div className="ff-assistant">
      <div className="row gap-8">
        <select className="input input-sm grow" value={profileId ?? ""} onChange={(e) => onSwitch(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row gap-8">
        <input className="input input-sm grow" placeholder="New profile (e.g. My child)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-sm" disabled={!newName.trim()} onClick={() => { onCreate(newName.trim(), "person"); setNewName(""); }}>
          <I.plus size={12} /> Add
        </button>
      </div>
      <div className="field">
        <label>Profile name</label>
        <input className="input input-sm" value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} />
      </div>
      {sections.map(([section, defs]) => (
        <details key={section} className="ff-prof-sec" open={section === "Identity" || section === "Business"}>
          <summary>{section}</summary>
          <div className="ff-prof-grid">
            {defs.map((d) => (
              <div className="field" key={d.key}>
                <label>{d.label}</label>
                {d.input === "textarea" ? (
                  <textarea className="textarea textarea-sm" rows={2} value={draft.data.values[d.key] ?? ""} onChange={(e) => set({ values: { ...draft.data.values, [d.key]: e.target.value } })} />
                ) : (
                  <input
                    className="input input-sm"
                    type={d.input ?? "text"}
                    value={draft.data.values[d.key] ?? ""}
                    onChange={(e) => set({ values: { ...draft.data.values, [d.key]: e.target.value } })}
                  />
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
      <details className="ff-prof-sec" open={draft.data.custom.length > 0}>
        <summary>Other saved answers ({draft.data.custom.length})</summary>
        <div className="col gap-8 mt-8">
          {draft.data.custom.map((c, i) => (
            <div key={i} className="row gap-4">
              <input className="input input-sm" style={{ flex: 1 }} value={c.label} onChange={(e) => set({ custom: draft.data.custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="input input-sm" style={{ flex: 1.3 }} value={c.value} onChange={(e) => set({ custom: draft.data.custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <button className="icon-btn" aria-label="Remove" onClick={() => set({ custom: draft.data.custom.filter((_, j) => j !== i) })}>
                <I.x size={12} />
              </button>
            </div>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={() => set({ custom: [...draft.data.custom, { label: "", value: "" }] })}>
            <I.plus size={12} /> Add an answer
          </button>
        </div>
      </details>
      <div className="ff-prof-sec">
        <div className="row between">
          <span className="small">Saved signature</span>
          <div className="row gap-4">
            {(["signature", "initials"] as const).map((k) => (
              <button key={k} className="btn btn-sm" onClick={() => onSignature(k)}>
                {draft.data[k] ? <img src={draft.data[k]!} alt="" style={{ height: 18 }} /> : <I.sign size={12} />} {k === "signature" ? "Signature" : "Initials"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        <I.lock size={10} /> Profiles never store Social Security, tax ID, bank, card, passport or license numbers, or medical details.
      </p>
      <div className="row between">
        <button className="btn btn-sm btn-ghost" onClick={() => { if (confirm(`Delete the profile "${current.name}"?`)) onDelete(current.id); }}>
          <I.trash size={12} /> Delete
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            await onSave({ ...draft, data: { ...draft.data, custom: draft.data.custom.filter((c) => c.label.trim() && c.value.trim()) } });
            setSaving(false);
            setDirty(false);
          }}
        >
          {saving && <span className="spinner" />} Save profile
        </button>
      </div>
    </div>
  );
}

export const profileKeyLabel = (k: string) => PROFILE_KEY_LABELS[k] ?? k;
