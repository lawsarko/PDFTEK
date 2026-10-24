import "server-only";
import { get, insert, run } from "./db";
import { sha256, token, now } from "./ids";

/** Single-use links sent by email. Only a hash is stored, so a database leak can't be replayed. */
export type TokenPurpose = "restore" | "reset" | "verify";

export function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number): string {
  const raw = token(32);
  // A new link replaces older unused ones for the same purpose.
  run("UPDATE login_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL", now(), userId, purpose);
  insert("login_tokens", { id: sha256(raw), user_id: userId, purpose, expires_at: now() + ttlMs });
  return raw;
}

/** Returns the user id if the link is valid, and marks it used. */
export function consumeToken(raw: string, purpose: TokenPurpose): string | null {
  if (!raw) return null;
  const row = get<{ id: string; user_id: string; expires_at: number; used_at: number | null; purpose: string }>("SELECT * FROM login_tokens WHERE id = ?", sha256(raw));
  if (!row || row.purpose !== purpose || row.used_at || row.expires_at < now()) return null;
  run("UPDATE login_tokens SET used_at = ? WHERE id = ?", now(), row.id);
  return row.user_id;
}

/** Checks a link without using it up (to show the reset form before the new password is sent). */
export function peekToken(raw: string, purpose: TokenPurpose): boolean {
  if (!raw) return false;
  const row = get<{ expires_at: number; used_at: number | null; purpose: string }>("SELECT expires_at, used_at, purpose FROM login_tokens WHERE id = ?", sha256(raw));
  return Boolean(row && row.purpose === purpose && !row.used_at && row.expires_at > now());
}
