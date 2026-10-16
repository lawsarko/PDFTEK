import "server-only";
import { all, get, insert, run, update, tx } from "./db";
import { id, now, sha256 } from "./ids";
import { putFile, readFile } from "./storage";
import { extractText, looksScanned, normalizeToPdf } from "./pdf";
import { notFound, conflict } from "./http";
import { logActivity } from "./activity";
import type { Ctx } from "./auth";

export type DocumentRow = {
  id: string;
  workspace_id: string;
  name: string;
  current_version_id: string | null;
  page_count: number;
  size: number;
  source_type: string;
  status: string;
  scanned: number;
  tags: string;
  checked_out_by: string | null;
  checked_out_at: number | null;
  assigned_to: string | null;
  draft_json: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type VersionRow = {
  id: string;
  document_id: string;
  version: number;
  storage_key: string;
  size: number;
  sha256: string;
  page_count: number;
  note: string;
  created_by: string;
  created_at: number;
};

export function serializeDoc(d: DocumentRow) {
  const names = userNames([d.checked_out_by, d.assigned_to, d.created_by]);
  return {
    id: d.id,
    name: d.name,
    pageCount: d.page_count,
    size: d.size,
    sourceType: d.source_type,
    status: d.status,
    scanned: Boolean(d.scanned),
    tags: JSON.parse(d.tags) as string[],
    checkedOutBy: d.checked_out_by ? { id: d.checked_out_by, name: names[d.checked_out_by] ?? "Someone" } : null,
    checkedOutAt: d.checked_out_at,
    assignedTo: d.assigned_to ? { id: d.assigned_to, name: names[d.assigned_to] ?? "Someone" } : null,
    createdBy: names[d.created_by] ?? "Unknown",
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    versionId: d.current_version_id,
  };
}
export type DocDTO = ReturnType<typeof serializeDoc>;

export function userNames(ids: (string | null)[]): Record<string, string> {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniq.length) return {};
  const rows = all<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE id IN (${uniq.map(() => "?").join(",")})`,
    ...uniq,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export function getDocument(ctx: Pick<Ctx, "workspace">, docId: string): DocumentRow {
  const d = get<DocumentRow>("SELECT * FROM documents WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL", docId, ctx.workspace.id);
  if (!d) throw notFound("Document not found.");
  return d;
}

export function currentVersion(doc: DocumentRow): VersionRow {
  const v = get<VersionRow>("SELECT * FROM document_versions WHERE id = ?", doc.current_version_id);
  if (!v) throw notFound("Document file missing.");
  return v;
}

export async function readCurrentPdf(doc: DocumentRow): Promise<Buffer> {
  return readFile(currentVersion(doc).storage_key);
}

export function listVersions(docId: string) {
  const rows = all<VersionRow>("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC", docId);
  const names = userNames(rows.map((r) => r.created_by));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    size: r.size,
    pageCount: r.page_count,
    note: r.note,
    createdBy: names[r.created_by] ?? "Unknown",
    createdAt: r.created_at,
    sha256: r.sha256,
  }));
}

async function indexPdf(docId: string, workspaceId: string, pdf: Buffer) {
  let pages: { page: number; text: string }[] = [];
  let count = 0;
  try {
    const r = await extractText(pdf);
    pages = r.pages;
    count = r.pageCount;
  } catch (err) {
    console.error("[pdftek] text extraction failed", err);
  }
  tx(() => {
    run("DELETE FROM page_text WHERE document_id = ?", docId);
    for (const p of pages) {
      run("INSERT INTO page_text (document_id, workspace_id, page, body) VALUES (?, ?, ?, ?)", docId, workspaceId, p.page, p.text);
    }
  });
  return { pageCount: count, scanned: looksScanned(pages) };
}

/** Stores OCR output for pages that had no text layer. */
export function saveOcrText(docId: string, workspaceId: string, pages: { page: number; text: string }[]) {
  tx(() => {
    for (const p of pages) {
      run("DELETE FROM page_text WHERE document_id = ? AND page = ?", docId, p.page);
      run("INSERT INTO page_text (document_id, workspace_id, page, body) VALUES (?, ?, ?, ?)", docId, workspaceId, p.page, p.text);
    }
    run("UPDATE documents SET scanned = 0, updated_at = ? WHERE id = ?", now(), docId);
  });
}

export function pageTexts(docId: string): { page: number; text: string }[] {
  return all<{ page: number; body: string }>(
    "SELECT page, body FROM page_text WHERE document_id = ? ORDER BY CAST(page AS INTEGER)",
    docId,
  ).map((r) => ({ page: Number(r.page), text: r.body }));
}

export async function createDocument(opts: {
  workspaceId: string;
  userId: string;
  name: string;
  data: Buffer;
  tags?: string[];
  actorLabel?: string;
}): Promise<DocumentRow> {
  const { pdf, sourceType } = await normalizeToPdf(opts.name, opts.data);
  const docId = id("doc_");
  const versionId = id("ver_");
  const key = await putFile(opts.workspaceId, pdf);
  const name = sourceType === "pdf" ? opts.name : opts.name.replace(/\.[^.]+$/, "") + ".pdf";
  const t = now();
  insert("documents", {
    id: docId,
    workspace_id: opts.workspaceId,
    name,
    current_version_id: versionId,
    page_count: 0,
    size: pdf.length,
    source_type: sourceType,
    status: "ready",
    tags: JSON.stringify(opts.tags ?? []),
    created_by: opts.userId,
    created_at: t,
    updated_at: t,
  });
  const { pageCount, scanned } = await indexPdf(docId, opts.workspaceId, pdf);
  insert("document_versions", {
    id: versionId,
    document_id: docId,
    version: 1,
    storage_key: key,
    size: pdf.length,
    sha256: sha256(pdf),
    page_count: pageCount,
    note: sourceType === "pdf" ? "Uploaded" : `Converted from .${sourceType}`,
    created_by: opts.userId,
    created_at: t,
  });
  update("documents", docId, { page_count: pageCount, scanned: scanned ? 1 : 0 });
  logActivity({
    workspaceId: opts.workspaceId,
    userId: opts.actorLabel ? null : opts.userId,
    actorLabel: opts.actorLabel,
    action: "uploaded",
    documentId: docId,
    meta: { name },
  });
  const doc = get<DocumentRow>("SELECT * FROM documents WHERE id = ?", docId)!;
  // Fire-and-forget: automations react to new documents.
  import("./automations").then((m) => m.onEvent("document_uploaded", { workspaceId: opts.workspaceId, documentId: docId })).catch((e) => console.error(e));
  return doc;
}

export async function addVersion(opts: { doc: DocumentRow; userId: string; pdf: Buffer; note: string }): Promise<VersionRow> {
  const key = await putFile(opts.doc.workspace_id, opts.pdf);
  const { pageCount, scanned } = await indexPdf(opts.doc.id, opts.doc.workspace_id, opts.pdf);
  const last = get<{ v: number }>("SELECT MAX(version) AS v FROM document_versions WHERE document_id = ?", opts.doc.id)?.v ?? 0;
  const row: VersionRow = {
    id: id("ver_"),
    document_id: opts.doc.id,
    version: last + 1,
    storage_key: key,
    size: opts.pdf.length,
    sha256: sha256(opts.pdf),
    page_count: pageCount,
    note: opts.note,
    created_by: opts.userId,
    created_at: now(),
  };
  insert("document_versions", row);
  update("documents", opts.doc.id, {
    current_version_id: row.id,
    page_count: pageCount,
    size: opts.pdf.length,
    scanned: scanned ? 1 : 0,
    updated_at: now(),
  });
  logActivity({ workspaceId: opts.doc.workspace_id, userId: opts.userId, action: "saved_version", documentId: opts.doc.id, meta: { version: row.version, note: opts.note } });
  return row;
}

/** Guards edits: if someone else holds the checkout lock, block the write. */
export function assertCanEdit(doc: DocumentRow, userId: string) {
  if (doc.checked_out_by && doc.checked_out_by !== userId) {
    const who = userNames([doc.checked_out_by])[doc.checked_out_by] ?? "another member";
    throw conflict(`${who} has this document checked out. Ask them to check it in or hand it off to you.`);
  }
}

export function searchWorkspace(workspaceId: string, q: string, limit = 30) {
  const ftsQuery = toFtsQuery(q);
  if (!ftsQuery) return [];
  return all<{ document_id: string; page: number; snippet: string; name: string; rank: number }>(
    `SELECT p.document_id, p.page, snippet(page_text, 3, '[[', ']]', ' … ', 18) AS snippet, d.name, bm25(page_text) AS rank
       FROM page_text p JOIN documents d ON d.id = p.document_id
      WHERE page_text MATCH ? AND p.workspace_id = ? AND d.deleted_at IS NULL
      ORDER BY rank LIMIT ?`,
    ftsQuery,
    workspaceId,
    limit,
  ).map((r) => ({ ...r, page: Number(r.page) }));
}

/** Converts free text into a safe FTS5 query (quoted terms, prefix match on the last one). */
export function toFtsQuery(q: string): string {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (!terms.length) return "";
  return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(" OR ");
}

/** Resolves a document by id and verifies the caller is a member of its workspace. */
export async function docAccess(docId: string) {
  const { requireMember } = await import("./auth");
  const row = get<{ workspace_id: string }>("SELECT workspace_id FROM documents WHERE id = ? AND deleted_at IS NULL", docId);
  if (!row) throw notFound("Document not found.");
  const ctx = await requireMember(row.workspace_id);
  return { ctx, doc: getDocument(ctx, docId) };
}
