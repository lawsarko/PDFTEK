"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PdfViewer } from "@/components/pdf-viewer";
import { I } from "@/components/icons";
import { useToast } from "@/components/toast";
import { api, errMsg } from "@/lib/client/api";
import { loadPdf } from "@/lib/client/pdf";
import { pagePayload } from "@/lib/client/form-geometry";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import {
  profileValue,
  slug,
  validate,
  type FieldType,
  type FormField,
  type FormTemplate,
  type FormValues,
  type Profile,
  type Rect,
} from "@/lib/forms";
import { FieldLayer } from "./overlay";
import { Assistant, FieldsList, Guided, ProfileEditor, isAnsweredOrSigned, needsCheck, type Filter } from "./panel";
import { BulkModal, LearnModal, SaveModal, SignModal, learnable, type Learn } from "./modals";

type Loaded = {
  document: { id: string; name: string; pageCount: number; versionId: string };
  template: FormTemplate;
  draft: { values: FormValues; profileId: string | null } | null;
  profiles: Profile[];
  ai: { available: boolean; freeForm: boolean };
};

type Tab = "fields" | "guided" | "ai" | "profile";
const NEW_TYPES: [FieldType, string][] = [
  ["text", "Text"],
  ["date", "Date"],
  ["checkbox", "Checkbox"],
  ["multiline", "Paragraph"],
  ["signature", "Signature"],
  ["initials", "Initials"],
];

export function FormFiller({ wid, docId }: { wid: string; docId: string }) {
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fields");
  const [filter, setFilter] = useState<Filter>("all");
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [mode, setMode] = useState<"fill" | "layout">("fill");
  const [newType, setNewType] = useState<FieldType>("text");
  const [scale, setScale] = useState(1.25);
  const [detecting, setDetecting] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [signing, setSigning] = useState<{ fieldId?: string; kind: "signature" | "initials"; forProfile?: boolean } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Doc | null>(null);
  const [learn, setLearn] = useState<Learn[] | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"doc" | "panel">("panel");
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const src = data ? `/api/documents/${docId}/file?version=${data.document.versionId}` : "";

  // ---------- loading ----------

  useEffect(() => {
    api<Loaded>(`/api/documents/${docId}/form`)
      .then((d) => {
        setData(d);
        setFields(d.template.fields);
        setProfiles(d.profiles);
        const pid = d.draft?.profileId && d.profiles.some((p) => p.id === d.draft!.profileId) ? d.draft.profileId : (d.profiles[0]?.id ?? null);
        setProfileId(pid);
        const start = d.draft?.values ?? {};
        const prof = d.profiles.find((p) => p.id === pid) ?? null;
        const filled = applyProfile(d.template.fields, start, prof, false);
        setValues(filled.values);
        setSignatures(filled.signatures);
        if (filled.count && prof) toast(`Filled ${filled.count} field${filled.count === 1 ? "" : "s"} from “${prof.name}”`, "success");
        // Small screens get one question at a time.
        if (window.matchMedia("(max-width: 860px)").matches) setTab("guided");
        loaded.current = true;
      })
      .catch((e) => setLoadError(errMsg(e)));
    api<WorkspaceInfo>(`/api/workspaces/${wid}`).then(setInfo).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, wid]);

  useEffect(() => {
    if (tab !== "ai" || docs) return;
    api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`)
      .then((r) => setDocs(r.documents.filter((d) => d.id !== docId)))
      .catch(() => setDocs([]));
  }, [tab, docs, wid, docId]);

  // Autosave answers in progress (sensitive answers are dropped server-side).
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      api(`/api/documents/${docId}/form`, { method: "PUT", json: { values, profileId } }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [values, profileId, docId]);

  // ---------- answers ----------

  const setValue = useCallback((id: string, value: string) => {
    setValues((v) => ({ ...v, [id]: { value, source: "you" } }));
  }, []);

  const errors = useMemo(() => Object.fromEntries(fields.map((f) => [f.id, values[f.id]?.value ? validate(f, values[f.id].value) : null])), [fields, values]);
  const order = useMemo(() => fields.filter((f) => !f.readOnly), [fields]);
  const answered = order.filter((f) => isAnsweredOrSigned(f, values[f.id], signatures) && f.type !== "checkbox").length;
  const total = order.filter((f) => f.type !== "checkbox").length;
  const missing = order.filter((f) => f.required && !isAnsweredOrSigned(f, values[f.id], signatures));
  const problems = order.filter((f) => needsCheck(f, values[f.id]));

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (!id) return;
      const f = fields.find((x) => x.id === id);
      if (!f) return;
      const pageEl = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${f.page}"]`);
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-fid="${f.id}"]`);
      if (el && pageEl) {
        const r = el.getBoundingClientRect();
        const box = scrollRef.current!.getBoundingClientRect();
        if (r.top < box.top + 40 || r.bottom > box.bottom - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
      } else pageEl?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [fields],
  );

  const nextTodo = () => {
    const start = Math.max(0, order.findIndex((f) => f.id === selected) + 1);
    const list = [...order.slice(start), ...order.slice(0, start)];
    const f = list.find((x) => !isAnsweredOrSigned(x, values[x.id], signatures) && x.type !== "checkbox");
    if (f) {
      select(f.id);
      setTimeout(() => scrollRef.current?.querySelector<HTMLElement>(`[data-fid="${f.id}"]`)?.focus(), 350);
    } else toast("Every field has an answer.", "success");
  };

  // ---------- profiles ----------

  const switchProfile = (id: string) => {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id) ?? null;
    const filled = applyProfile(fields, values, p, true, signatures);
    setValues(filled.values);
    setSignatures(filled.signatures);
    if (p) toast(`Now filling as “${p.name}”${filled.count ? `: ${filled.count} fields updated` : ""}`, "success");
  };

  const createProfile = async (name: string, kind: "person" | "business") => {
    try {
      const r = await api<{ profile: Profile }>("/api/form-profiles", { method: "POST", json: { name, kind } });
      setProfiles((ps) => [...ps, r.profile]);
      setProfileId(r.profile.id);
      setTab("profile");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const saveProfile = async (p: Profile) => {
    try {
      const r = await api<{ profile: Profile }>(`/api/form-profiles/${p.id}`, { method: "PATCH", json: { name: p.name, data: p.data } });
      setProfiles((ps) => ps.map((x) => (x.id === p.id ? r.profile : x)));
      const filled = applyProfile(fields, values, r.profile, true, signatures);
      setValues(filled.values);
      setSignatures(filled.signatures);
      toast(`Profile saved${filled.count ? `, ${filled.count} fields filled` : ""}`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const deleteProfile = async (id: string) => {
    await api(`/api/form-profiles/${id}`, { method: "DELETE" }).catch(() => {});
    const rest = profiles.filter((p) => p.id !== id);
    setProfiles(rest);
    setProfileId(rest[0]?.id ?? null);
  };

  // ---------- AI ----------

  const setupWithAi = async () => {
    if (!data) return;
    setDetecting("Opening the form…");
    try {
      const pdf = await loadPdf(src);
      const n = Math.min(pdf.numPages, 30);
      const pages = [];
      for (let i = 1; i <= n; i++) {
        setDetecting(`Reading page ${i} of ${n}…`);
        pages.push(await pagePayload(pdf, i, data.template.acro ? 1300 : 1600, !data.template.acro));
      }
      setDetecting(data.template.acro ? "Understanding the questions…" : "Finding every field…");
      const r = await api<{ template: FormTemplate }>(`/api/documents/${docId}/form/detect`, { method: "POST", json: { pages } });
      setData({ ...data, template: r.template, ai: { ...data.ai, freeForm: data.ai.freeForm } });
      setFields(r.template.fields);
      const filled = applyProfile(r.template.fields, data.template.acro ? values : {}, profile, false, data.template.acro ? signatures : {});
      setValues(filled.values);
      setSignatures(filled.signatures);
      toast(`Found ${r.template.fields.length} fields${filled.count ? `, ${filled.count} filled from your profile` : ""}.`, "success");
      if (r.template.summary) setTab((t) => (t === "guided" ? t : "ai"));
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setDetecting(null);
    }
  };

  const fillWithAi = async () => {
    setFilling(true);
    try {
      const r = await api<{ values: FormValues; questions: string[] }>(`/api/documents/${docId}/form/fill`, {
        method: "POST",
        json: { profileId, instructions, sourceIds, current: values },
      });
      let n = 0;
      setValues((cur) => {
        const next = { ...cur };
        for (const [id, v] of Object.entries(r.values)) {
          if (cur[id]?.source === "you" && cur[id].value) continue;
          next[id] = v;
          n++;
        }
        return next;
      });
      setQuestions(r.questions);
      setTimeout(() => toast(n ? `AI filled ${n} field${n === 1 ? "" : "s"}. Amber ones are worth a check.` : "AI didn't find anything new to fill.", n ? "success" : "info"), 0);
      if (n) setFilter("all");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setFilling(false);
    }
  };

  // ---------- layout editing ----------

  const persistFields = useCallback(
    async (next: FormField[]) => {
      try {
        const r = await api<{ template: FormTemplate }>(`/api/documents/${docId}/form`, { method: "PATCH", json: { fields: next } });
        setData((d) => (d ? { ...d, template: r.template } : d));
      } catch (e) {
        toast(errMsg(e), "error");
      }
    },
    [docId, toast],
  );

  const addField = (page: number, rect: Rect) => {
    const id = `m${Date.now().toString(36)}`;
    const label = NEW_TYPES.find(([t]) => t === newType)![1];
    const f: FormField = {
      id,
      page,
      rect,
      type: newType,
      label: `${label} ${fields.filter((x) => x.type === newType).length + 1}`,
      profileKey: newType === "signature" ? "signature" : newType === "initials" ? "initials" : null,
      format: newType === "date" ? "MM/DD/YYYY" : undefined,
    };
    setFields((fs) => [...fs, f]);
    setSelected(id);
  };

  const moveField = (id: string, rect: Rect, optionIndex?: number) =>
    setFields((fs) =>
      fs.map((f) =>
        f.id !== id ? f : optionIndex !== undefined && f.options ? { ...f, options: f.options.map((o, i) => (i === optionIndex ? { ...o, rect } : o)) } : { ...f, rect },
      ),
    );

  const deleteField = (id: string) => {
    setFields((fs) => fs.filter((f) => f.id !== id));
    setSelected(null);
  };

  const finishLayout = async () => {
    setMode("fill");
    await persistFields(fields);
    toast("Fields saved. This form is ready to fill again any time.", "success");
  };

  // ---------- signatures ----------

  const openSign = (fieldId: string) => {
    const f = fields.find((x) => x.id === fieldId);
    setSigning({ fieldId, kind: f?.type === "initials" ? "initials" : "signature" });
  };

  const applySignature = async (png: string, opts: { save: boolean; all: boolean }) => {
    if (!signing) return;
    const kind = signing.kind;
    if (signing.fieldId) {
      setSignatures((s) => {
        const next = { ...s, [signing.fieldId!]: png };
        if (opts.all) for (const f of fields) if (f.type === kind && !next[f.id]) next[f.id] = png;
        return next;
      });
    }
    if ((opts.save || signing.forProfile) && profile) {
      await saveProfile({ ...profile, data: { ...profile.data, [kind]: png } });
    }
    setSigning(null);
  };

  // ---------- saving ----------

  const save = async (opts: { name: string; flatten: boolean }) => {
    setSaving(true);
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${docId}/form/save`, {
        method: "POST",
        json: { values, signatures, flatten: opts.flatten, name: opts.name },
      });
      setSaved(r.document);
      const items = learnable(fields, values, profile);
      if (items.length) setLearn(items);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const saveLearned = async (items: Learn[]) => {
    let p = profile;
    if (!p) {
      const r = await api<{ profile: Profile }>("/api/form-profiles", { method: "POST", json: { name: "Me", kind: "person" } });
      p = r.profile;
      setProfiles((ps) => [...ps, r.profile]);
      setProfileId(r.profile.id);
    }
    const valuesNext = { ...p.data.values };
    const custom = [...p.data.custom];
    for (const it of items) {
      if (!it.custom) valuesNext[it.key] = it.value;
      else {
        const i = custom.findIndex((c) => slug(c.label) === slug(it.label));
        if (i >= 0) custom[i] = { label: it.label, value: it.value };
        else custom.push({ label: it.label, value: it.value });
      }
    }
    await saveProfile({ ...p, data: { ...p.data, values: valuesNext, custom } });
    setLearn(null);
  };

  // ---------- render ----------

  if (loadError) return <div className="empty">{loadError}</div>;
  if (!data) return <div className="empty"><span className="spinner spinner-lg" /></div>;

  const noFields = fields.length === 0;
  const fromPdfOnly = data.template.acro && data.template.detectedBy === "pdf";
  const userName = (profile ? profileValue("full_name", profile.data) : "") || info?.me.name || "";
  const pct = total ? Math.round((answered / total) * 100) : 0;

  return (
    <AppShell
      wid={wid}
      title={`Fill form · ${data.document.name}`}
      actions={
        <button className="btn btn-primary btn-sm" disabled={noFields || mode === "layout"} onClick={() => { setSaved(null); setSaveOpen(true); }}>
          <I.check size={14} /> <span className="hide-mobile">Save &amp; download</span><span className="show-mobile">Save</span>
        </button>
      }
    >
      <div className="ff-main" data-view={mobileView}>
        <section className="viewer ff-viewer">
          <div className="ff-toolbar">
            {mode === "fill" ? (
              <>
                <div className="ff-progress-pill" title={`${answered} of ${total} answered`}>
                  <svg viewBox="0 0 36 36" width="22" height="22">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="4" />
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--amber)" strokeWidth="4" strokeDasharray={`${(pct / 100) * 94.2} 94.2`} transform="rotate(-90 18 18)" strokeLinecap="round" />
                  </svg>
                  <span><b>{answered}</b>/{total}</span>
                </div>
                <button className="tool-btn" onClick={nextTodo} disabled={noFields}>
                  Next empty <I.right size={12} />
                </button>
                <span className="grow" />
                <button className="tool-btn hide-mobile" onClick={() => setMode("layout")} title="Add, move or remove fields">
                  <I.edit size={13} /> Edit fields
                </button>
                <button className="tool-btn hide-mobile" onClick={() => setBulkOpen(true)} disabled={noFields} title="Fill one copy per row of a spreadsheet">
                  <I.table size={13} /> Fill many
                </button>
              </>
            ) : (
              <>
                <span className="small"><b>Edit fields:</b> pick a type, then click the page to add it. Drag to move.</span>
                <span className="row gap-4 wrap">
                  {NEW_TYPES.map(([t, l]) => (
                    <button key={t} className={`chip ${newType === t ? "active" : ""}`} onClick={() => setNewType(t)}>
                      {l}
                    </button>
                  ))}
                </span>
                <span className="grow" />
                <button className="btn btn-primary btn-sm" onClick={finishLayout}>Done</button>
              </>
            )}
            <span className="row gap-4">
              <button className="icon-btn" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))}><I.zoomOut size={14} /></button>
              <button className="icon-btn" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)))}><I.zoomIn size={14} /></button>
            </span>
          </div>
          <div className="page-scroll" ref={scrollRef}>
            <PdfViewer
              src={src}
              scale={scale}
              textLayer={false}
              scrollRef={scrollRef}
              renderOverlay={(pinfo) => (
                <FieldLayer
                  info={pinfo}
                  fields={fields.filter((f) => f.page === pinfo.page || f.options?.some((o) => o.page === pinfo.page))}
                  values={values}
                  signatures={signatures}
                  errors={errors}
                  selected={selected}
                  mode={mode}
                  newType={newType}
                  onChange={setValue}
                  onSelect={(id) => setSelected(id)}
                  onSign={openSign}
                  onRect={moveField}
                  onAdd={addField}
                  onDelete={deleteField}
                />
              )}
            />
          </div>
        </section>

        <aside className="ff-panel">
          {(noFields || fromPdfOnly) && mode === "fill" && (
            <div className={`ff-setup ${noFields ? "big" : ""}`}>
              {detecting ? (
                <div className="row gap-8"><span className="spinner" /> <span className="small">{detecting}</span></div>
              ) : noFields ? (
                <>
                  <div className="ff-setup-icon"><I.sparkle size={20} /></div>
                  <h3>Let AI read this form</h3>
                  <p className="small muted">
                    It finds every blank, box and signature line, explains each question in plain English, and links answers to your profile, even on scans.
                  </p>
                  <button className="btn btn-primary btn-lg" onClick={setupWithAi} disabled={!data.ai.available}>
                    <I.sparkle size={16} /> Find the fields
                  </button>
                  <span className="tiny faint">{!data.ai.available ? "AI isn't set up on this server." : data.ai.freeForm ? "Your first form this month is free." : "Uses a few AI credits."}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setMode("layout")}>Or add fields by hand</button>
                </>
              ) : (
                <>
                  <span className="small grow">
                    <b>{fields.length} fillable fields found.</b> Let AI turn them into clear questions with help and autofill.
                  </span>
                  <button className="btn btn-sm" onClick={setupWithAi} disabled={!data.ai.available}>
                    <I.sparkle size={13} /> Improve with AI
                  </button>
                </>
              )}
            </div>
          )}

          <div className="ff-profile-bar">
            <I.user size={14} />
            <span className="small muted">Filling as</span>
            {profiles.length ? (
              <select className="input input-sm" value={profileId ?? ""} onChange={(e) => switchProfile(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <button className="btn btn-sm btn-ghost" onClick={() => setTab("profile")}>Set up my profile</button>
            )}
          </div>

          <div className="ff-tabs" role="tablist">
            {(
              [
                ["fields", "Fields", <I.form key="i" size={13} />],
                ["guided", "One by one", <I.steps key="i" size={13} />],
                ["ai", "AI assist", <I.sparkle key="i" size={13} />],
                ["profile", "Profile", <I.user key="i" size={13} />],
              ] as const
            ).map(([k, l, icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {icon} {l}
              </button>
            ))}
          </div>

          <div className="ff-tab-body">
            {tab === "fields" && (
              <FieldsList
                fields={order}
                values={values}
                signatures={signatures}
                selected={selected}
                filter={filter}
                onFilter={setFilter}
                onSelect={select}
                onChange={setValue}
                onSign={openSign}
                onLabel={mode === "layout" ? (id, label) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, label } : f))) : undefined}
              />
            )}
            {tab === "guided" && (
              <Guided
                fields={order}
                values={values}
                signatures={signatures}
                index={guidedIndex}
                setIndex={(i) => {
                  setGuidedIndex(i);
                  if (order[i]) setSelected(order[i].id);
                }}
                onChange={setValue}
                onSign={openSign}
                onFinish={() => { setSaved(null); setSaveOpen(true); }}
              />
            )}
            {tab === "ai" && (
              <Assistant
                summary={data.template.summary}
                docs={docs}
                sourceIds={sourceIds}
                setSourceIds={setSourceIds}
                instructions={instructions}
                setInstructions={setInstructions}
                questions={questions}
                busy={filling}
                aiAvailable={data.ai.available && !noFields}
                freeForm={data.ai.freeForm}
                onFill={fillWithAi}
              />
            )}
            {tab === "profile" && (
              <ProfileEditor
                profiles={profiles}
                profileId={profileId}
                onSwitch={switchProfile}
                onCreate={createProfile}
                onSave={saveProfile}
                onDelete={deleteProfile}
                onSignature={(kind) => setSigning({ kind, forProfile: true })}
              />
            )}
          </div>
        </aside>

        <nav className="ff-mobile-switch">
          <button className={mobileView === "panel" ? "on" : ""} onClick={() => setMobileView("panel")}><I.form size={16} /> Questions</button>
          <button className={mobileView === "doc" ? "on" : ""} onClick={() => setMobileView("doc")}><I.file size={16} /> Document</button>
        </nav>
      </div>

      {signing && (
        <SignModal
          kind={signing.kind}
          name={signing.kind === "initials" ? userName : userName}
          saved={signing.forProfile ? null : (profile?.data[signing.kind] ?? null)}
          canSave={Boolean(profile) && !signing.forProfile}
          count={signing.fieldId ? fields.filter((f) => f.type === signing.kind && f.id !== signing.fieldId && !signatures[f.id]).length : 0}
          onDone={applySignature}
          onClose={() => setSigning(null)}
        />
      )}
      {saveOpen && !learn && (
        <SaveModal
          docName={data.document.name}
          missing={missing}
          problems={problems}
          busy={saving}
          result={saved}
          wid={wid}
          onSave={save}
          onClose={() => { setSaveOpen(false); setSaved(null); }}
        />
      )}
      {learn && <LearnModal items={learn} profileName={profile?.name ?? "a new profile"} onSave={saveLearned} onClose={() => setLearn(null)} />}
      {bulkOpen && <BulkModal docId={docId} docName={data.document.name} fields={order} values={values} signatures={signatures} onClose={() => setBulkOpen(false)} />}
    </AppShell>
  );
}

/**
 * Fills fields linked to profile entries. Without `overwrite`, only empty fields are touched;
 * with it, earlier profile answers are replaced too (switching profiles). Typed answers always stay.
 */
function applyProfile(fields: FormField[], current: FormValues, profile: Profile | null, overwrite: boolean, sigs: Record<string, string> = {}) {
  const values = { ...current };
  const signatures = { ...sigs };
  let count = 0;
  // Without a profile, only what needs none (today's date next to a signature).
  const data = profile?.data ?? { values: {}, custom: [] };
  for (const f of fields) {
    if (f.type === "signature" || f.type === "initials") {
      const png = data[f.type === "initials" ? "initials" : "signature"];
      if (png && !signatures[f.id] && f.profileKey !== null) {
        signatures[f.id] = png;
        count++;
      }
      continue;
    }
    if (!f.profileKey || f.sensitive) continue;
    const cur = values[f.id];
    if (cur?.value && (cur.source === "you" || !overwrite)) continue;
    const v = profileValue(f.profileKey, data, f);
    if (!v || cur?.value === v) continue;
    values[f.id] = { value: v, source: "profile" };
    count++;
  }
  return { values, signatures, count };
}
