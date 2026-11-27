import "server-only";
import { all, get, insert, run } from "./db";
import { id, now } from "./ids";
import { notFound } from "./http";
import type { DocumentRow } from "./documents";
import { readCurrentPdf } from "./documents";
import { readAcroFields } from "./form-pdf";
import { emptyProfile, type FormField, type FormSummary, type FormTemplate, type FormValues, type Profile, type ProfileData, type ProfileKind } from "./forms";

// ---------- templates ----------

type TemplateRow = { document_id: string; version_id: string; fields_json: string; summary_json: string | null; acro: number; detected_by: string; updated_at: number };

function toTemplate(r: TemplateRow): FormTemplate {
  return {
    fields: JSON.parse(r.fields_json),
    summary: r.summary_json ? JSON.parse(r.summary_json) : null,
    acro: Boolean(r.acro),
    detectedBy: r.detected_by as FormTemplate["detectedBy"],
    versionId: r.version_id,
    updatedAt: r.updated_at,
  };
}

/**
 * The form's fields for the document's current version. A fillable PDF gets its own fields right
 * away (no AI needed); a flat form starts empty until AI reads it or fields are added by hand.
 */
export async function templateFor(doc: DocumentRow): Promise<FormTemplate> {
  const row = get<TemplateRow>("SELECT * FROM form_templates WHERE document_id = ?", doc.id);
  if (row && row.version_id === doc.current_version_id) return toTemplate(row);
  const fields = await readAcroFields(await readCurrentPdf(doc));
  return saveTemplate(doc, { fields, summary: row ? JSON.parse(row.summary_json ?? "null") : null, acro: fields.length > 0, detectedBy: "pdf" });
}

export function saveTemplate(doc: DocumentRow, t: { fields: FormField[]; summary: FormSummary | null; acro: boolean; detectedBy: FormTemplate["detectedBy"] }): FormTemplate {
  const row: TemplateRow = {
    document_id: doc.id,
    version_id: doc.current_version_id!,
    fields_json: JSON.stringify(t.fields),
    summary_json: t.summary ? JSON.stringify(t.summary) : null,
    acro: t.acro ? 1 : 0,
    detected_by: t.detectedBy,
    updated_at: now(),
  };
  run(
    `INSERT INTO form_templates (document_id, workspace_id, version_id, fields_json, summary_json, acro, detected_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET version_id = excluded.version_id, fields_json = excluded.fields_json, summary_json = excluded.summary_json,
       acro = excluded.acro, detected_by = excluded.detected_by, updated_at = excluded.updated_at`,
    row.document_id,
    doc.workspace_id,
    row.version_id,
    row.fields_json,
    row.summary_json,
    row.acro,
    row.detected_by,
    row.updated_at,
  );
  return toTemplate(row);
}

// ---------- drafts ----------

/** Saves answers in progress, leaving out sensitive ones (SSNs and the like are never stored). */
export function saveDraft(documentId: string, userId: string, fields: FormField[], values: FormValues, profileId: string | null) {
  const sensitive = new Set(fields.filter((f) => f.sensitive).map((f) => f.id));
  const kept = Object.fromEntries(Object.entries(values).filter(([k, v]) => !sensitive.has(k) && v.value.length <= 5000));
  run(
    `INSERT INTO form_drafts (document_id, user_id, values_json, profile_id, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(document_id, user_id) DO UPDATE SET values_json = excluded.values_json, profile_id = excluded.profile_id, updated_at = excluded.updated_at`,
    documentId,
    userId,
    JSON.stringify(kept),
    profileId,
    now(),
  );
}

export function draftFor(documentId: string, userId: string): { values: FormValues; profileId: string | null } | null {
  const r = get<{ values_json: string; profile_id: string | null }>("SELECT values_json, profile_id FROM form_drafts WHERE document_id = ? AND user_id = ?", documentId, userId);
  return r ? { values: JSON.parse(r.values_json), profileId: r.profile_id } : null;
}

// ---------- profiles ----------

type ProfileRow = { id: string; user_id: string; name: string; kind: string; data_json: string; updated_at: number };

const toProfile = (r: ProfileRow): Profile => ({ id: r.id, name: r.name, kind: r.kind as ProfileKind, data: { ...emptyProfile(), ...JSON.parse(r.data_json) }, updatedAt: r.updated_at });

export function listProfiles(userId: string): Profile[] {
  return all<ProfileRow>("SELECT * FROM form_profiles WHERE user_id = ? ORDER BY created_at", userId).map(toProfile);
}

export function getProfile(userId: string, profileId: string): Profile {
  const r = get<ProfileRow>("SELECT * FROM form_profiles WHERE id = ? AND user_id = ?", profileId, userId);
  if (!r) throw notFound("Profile not found.");
  return toProfile(r);
}

export function createProfile(userId: string, name: string, kind: ProfileKind, data: ProfileData = emptyProfile()): Profile {
  const t = now();
  const row = { id: id("prf_"), user_id: userId, name, kind, data_json: JSON.stringify(data), created_at: t, updated_at: t };
  insert("form_profiles", row);
  return toProfile(row);
}

export function updateProfile(userId: string, profileId: string, patch: { name?: string; kind?: ProfileKind; data?: ProfileData }): Profile {
  const cur = getProfile(userId, profileId);
  const next = { name: patch.name ?? cur.name, kind: patch.kind ?? cur.kind, data: patch.data ?? cur.data };
  run("UPDATE form_profiles SET name = ?, kind = ?, data_json = ?, updated_at = ? WHERE id = ? AND user_id = ?", next.name, next.kind, JSON.stringify(next.data), now(), profileId, userId);
  return getProfile(userId, profileId);
}

export function deleteProfile(userId: string, profileId: string) {
  run("DELETE FROM form_profiles WHERE id = ? AND user_id = ?", profileId, userId);
}
