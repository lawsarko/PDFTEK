import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  trial_ends_at INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  playbook TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_version_id TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'pdf',
  status TEXT NOT NULL DEFAULT 'ready',
  scanned INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  checked_out_by TEXT,
  checked_out_at INTEGER,
  assigned_to TEXT,
  draft_json TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_documents_ws ON documents(workspace_id, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(document_id, version);

CREATE VIRTUAL TABLE IF NOT EXISTS page_text USING fts5(
  document_id UNINDEXED,
  workspace_id UNINDEXED,
  page UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  preset TEXT NOT NULL,
  title TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_scope ON chat_messages(workspace_id, document_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  document_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS doc_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  due_date TEXT,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  document_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  viewed_at INTEGER,
  completed_at INTEGER,
  last_reminded_at INTEGER
);

CREATE TABLE IF NOT EXISTS signature_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  sequential INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  completed_at INTEGER,
  signed_version_id TEXT
);

CREATE TABLE IF NOT EXISTS signers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  viewed_at INTEGER,
  signed_at INTEGER,
  ip TEXT,
  user_agent TEXT,
  signature_png TEXT,
  decline_reason TEXT,
  last_reminded_at INTEGER
);

CREATE TABLE IF NOT EXISTS signature_fields (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'signature',
  value TEXT
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_type TEXT NOT NULL,
  trigger_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  log TEXT NOT NULL DEFAULT '',
  document_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_auto ON automation_runs(automation_id, created_at);

CREATE TABLE IF NOT EXISTS reminders_sent (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Free-tier metering: completed tasks per subject (workspace or guest IP) per UTC day.
CREATE TABLE IF NOT EXISTS usage_daily (
  subject TEXT NOT NULL,
  day TEXT NOT NULL,
  tasks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, day)
);

-- Every completed payment, keyed by the Stripe Checkout session so fulfilment is idempotent.
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  product TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  email TEXT,
  stripe_session_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- Credit movements (purchases, monthly allowances, AI usage, extra tasks) for a transparent history.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_ws ON credit_ledger(workspace_id, created_at);

-- One-time sign-in links (e.g. recovering a purchase made without an account). Stored hashed.
CREATE TABLE IF NOT EXISTS login_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
`;

/** Columns added after the first release; created on startup when missing. */
const ADDED_COLUMNS: [table: string, column: string, ddl: string, backfill?: string][] = [
  ["users", "is_guest", "INTEGER NOT NULL DEFAULT 0"],
  ["workspaces", "pass_until", "INTEGER"],
  ["workspaces", "credits", "INTEGER NOT NULL DEFAULT 0"],
  ["workspaces", "allowance_credits", "INTEGER NOT NULL DEFAULT 0"],
  ["workspaces", "allowance_expires_at", "INTEGER"],
  ["workspaces", "billing_interval", "TEXT"],
  // Accounts created before email verification existed are treated as verified.
  ["users", "email_verified_at", "INTEGER", "UPDATE users SET email_verified_at = created_at WHERE is_guest = 0"],
  // Supabase Auth user id (see src/lib/supabase.ts).
  ["users", "supabase_id", "TEXT"],
  ["login_tokens", "purpose", "TEXT NOT NULL DEFAULT 'restore'"],
];

type GlobalWithDb = typeof globalThis & { __pdftekDb?: DatabaseSync };

function open(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "pdftek.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  for (const [table, column, ddl, backfill] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      if (backfill) db.exec(backfill);
    }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON users(supabase_id) WHERE supabase_id IS NOT NULL");
  return db;
}

export function getDb(): DatabaseSync {
  const g = globalThis as GlobalWithDb;
  if (!g.__pdftekDb) g.__pdftekDb = open();
  return g.__pdftekDb;
}

type Params = SQLInputValue[];

function norm(params: unknown[]): Params {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p as SQLInputValue;
  });
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...norm(params)) as T[];
}

export function get<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...norm(params)) as T | undefined;
}

export function run(sql: string, ...params: unknown[]) {
  return getDb().prepare(sql).run(...norm(params));
}

export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Insert a row from a plain object. Column names are trusted (never user input). */
export function insert(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  return run(sql, ...cols.map((c) => row[c]));
}

/** Update a row by id from a plain object. Column names are trusted (never user input). */
export function update(table: string, id: string, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`;
  return run(sql, ...cols.map((c) => patch[c]), id);
}
