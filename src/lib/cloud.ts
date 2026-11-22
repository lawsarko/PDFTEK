import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, get, run } from "./db";
import { now, token } from "./ids";
import { HttpError, badRequest } from "./http";
import { appUrl } from "./mail";

/**
 * Cloud storage connections: Google Drive, Dropbox and OneDrive.
 *
 * Each person connects their own account (OAuth). Tokens are encrypted at rest with a key kept on
 * the data disk (or CLOUD_TOKEN_KEY). pdftek asks for the narrowest access each service offers:
 * Google Drive only sees files the person picks or pdftek saves (drive.file).
 */

export type Provider = "google" | "dropbox" | "onedrive";
export const PROVIDERS: Provider[] = ["google", "dropbox", "onedrive"];
export const PROVIDER_NAME: Record<Provider, string> = { google: "Google Drive", dropbox: "Dropbox", onedrive: "OneDrive" };

export type CloudItem = { id: string; name: string; folder: boolean; size?: number; modified?: string; mime?: string };

const env = (k: string) => process.env[k]?.trim() || "";

/** Which services are set up on this server (each needs its own app credentials). */
export function configured(p: Provider): boolean {
  if (p === "google") return Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("GOOGLE_API_KEY"));
  if (p === "dropbox") return Boolean(env("DROPBOX_APP_KEY") && env("DROPBOX_APP_SECRET"));
  return Boolean(env("MICROSOFT_CLIENT_ID") && env("MICROSOFT_CLIENT_SECRET"));
}

export const isProvider = (p: string): p is Provider => (PROVIDERS as string[]).includes(p);
const redirectUri = (p: Provider) => appUrl(`/api/cloud/${p}/callback`);

// ---------- token encryption ----------

let key: Buffer | null = null;
function secret(): Buffer {
  if (key) return key;
  const fromEnv = env("CLOUD_TOKEN_KEY");
  if (fromEnv) return (key = crypto.createHash("sha256").update(fromEnv).digest());
  const file = path.join(DATA_DIR, "cloud.key");
  try {
    key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  } catch {
    key = crypto.randomBytes(32);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  }
  return key;
}
function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function open(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", secret(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------- OAuth ----------

const SCOPES: Record<Provider, string> = {
  google: "https://www.googleapis.com/auth/drive.file openid email",
  dropbox: "account_info.read files.metadata.read files.content.read files.content.write",
  onedrive: "offline_access Files.ReadWrite User.Read",
};

export function authorizeUrl(p: Provider, userId: string, returnTo: string): string {
  if (!configured(p)) throw badRequest(`${PROVIDER_NAME[p]} isn't set up on this server yet.`);
  const state = token(18);
  run("DELETE FROM oauth_states WHERE created_at < ?", now() - 3600_000);
  run("INSERT INTO oauth_states (state, user_id, provider, return_to, created_at) VALUES (?, ?, ?, ?, ?)", state, userId, p, returnTo, now());
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (p === "google")
    return `https://accounts.google.com/o/oauth2/v2/auth?${q({ client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(p), response_type: "code", scope: SCOPES.google, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })}`;
  if (p === "dropbox")
    return `https://www.dropbox.com/oauth2/authorize?${q({ client_id: env("DROPBOX_APP_KEY"), redirect_uri: redirectUri(p), response_type: "code", token_access_type: "offline", scope: SCOPES.dropbox, state })}`;
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q({ client_id: env("MICROSOFT_CLIENT_ID"), redirect_uri: redirectUri(p), response_type: "code", scope: SCOPES.onedrive, response_mode: "query", state })}`;
}

type TokenSet = { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };

async function tokenRequest(p: Provider, params: Record<string, string>): Promise<TokenSet> {
  const urls: Record<Provider, string> = {
    google: "https://oauth2.googleapis.com/token",
    dropbox: "https://api.dropboxapi.com/oauth2/token",
    onedrive: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  };
  const creds: Record<Provider, [string, string]> = {
    google: [env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET")],
    dropbox: [env("DROPBOX_APP_KEY"), env("DROPBOX_APP_SECRET")],
    onedrive: [env("MICROSOFT_CLIENT_ID"), env("MICROSOFT_CLIENT_SECRET")],
  };
  const res = await fetch(urls[p], {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: creds[p][0], client_secret: creds[p][1], ...(p === "onedrive" ? { scope: SCOPES.onedrive } : {}) }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenSet & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new HttpError(502, `${PROVIDER_NAME[p]} didn't accept the sign-in (${data.error_description || data.error || res.status}). Please try connecting again.`);
  return data;
}

async function accountName(p: Provider, access: string, t: TokenSet): Promise<string> {
  try {
    if (p === "google" && t.id_token) return (JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? "";
    if (p === "dropbox") {
      const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { authorization: `Bearer ${access}` } });
      return ((await r.json()) as { email?: string }).email ?? "";
    }
    if (p === "onedrive") {
      const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { authorization: `Bearer ${access}` } });
      const me = (await r.json()) as { mail?: string; userPrincipalName?: string };
      return me.mail || me.userPrincipalName || "";
    }
  } catch {}
  return "";
}

/** Finishes the OAuth flow: stores the connection and returns where to send the person back. */
export async function completeAuthorization(p: Provider, state: string, code: string): Promise<string> {
  const s = get<{ user_id: string; provider: string; return_to: string; created_at: number }>("SELECT * FROM oauth_states WHERE state = ?", state);
  if (!s || s.provider !== p || now() - s.created_at > 3600_000) throw badRequest("This sign-in link has expired. Please connect again.");
  run("DELETE FROM oauth_states WHERE state = ?", state);
  const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
  const account = await accountName(p, t.access_token, t);
  run(
    `INSERT INTO cloud_connections (user_id, provider, account, access_enc, refresh_enc, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET account = excluded.account, access_enc = excluded.access_enc, refresh_enc = coalesce(excluded.refresh_enc, cloud_connections.refresh_enc), expires_at = excluded.expires_at`,
    s.user_id,
    p,
    account,
    seal(t.access_token),
    t.refresh_token ? seal(t.refresh_token) : null,
    t.expires_in ? now() + t.expires_in * 1000 : null,
    now(),
  );
  return s.return_to;
}

type ConnRow = { user_id: string; provider: Provider; account: string; access_enc: string; refresh_enc: string | null; expires_at: number | null; created_at: number };

export function connections(userId: string) {
  return PROVIDERS.map((p) => {
    const c = get<ConnRow>("SELECT * FROM cloud_connections WHERE user_id = ? AND provider = ?", userId, p);
    return { provider: p, name: PROVIDER_NAME[p], available: configured(p), connected: Boolean(c), account: c?.account ?? null };
  });
}

export function disconnect(userId: string, p: Provider) {
  run("DELETE FROM cloud_connections WHERE user_id = ? AND provider = ?", userId, p);
}

/** A valid access token, refreshed when it's about to expire. */
export async function accessToken(userId: string, p: Provider): Promise<string> {
  const c = get<ConnRow>("SELECT * FROM cloud_connections WHERE user_id = ? AND provider = ?", userId, p);
  if (!c) throw new HttpError(409, `Connect ${PROVIDER_NAME[p]} first.`, "cloud_not_connected");
  if (!c.expires_at || c.expires_at - now() > 60_000) return open(c.access_enc);
  if (!c.refresh_enc) throw new HttpError(409, `Your ${PROVIDER_NAME[p]} sign-in expired. Connect it again.`, "cloud_not_connected");
  try {
    const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: open(c.refresh_enc) });
    run(
      "UPDATE cloud_connections SET access_enc = ?, refresh_enc = coalesce(?, refresh_enc), expires_at = ? WHERE user_id = ? AND provider = ?",
      seal(t.access_token),
      t.refresh_token ? seal(t.refresh_token) : null,
      t.expires_in ? now() + t.expires_in * 1000 : null,
      userId,
      p,
    );
    return t.access_token;
  } catch {
    throw new HttpError(409, `Your ${PROVIDER_NAME[p]} sign-in expired or was revoked. Connect it again.`, "cloud_not_connected");
  }
}

// ---------- files ----------

const SUPPORTED = /\.(pdf|docx?|odt|rtf|txt|md|csv|pptx?|odp|xlsx?|ods|html?|jpe?g|png|webp|heic|gif|bmp|tiff?)$/i;
export const importable = (name: string) => SUPPORTED.test(name);

async function call<T>(p: Provider, url: string, access: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${access}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
  if (res.status === 401) throw new HttpError(409, `Your ${PROVIDER_NAME[p]} sign-in expired. Connect it again.`, "cloud_not_connected");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(502, `${PROVIDER_NAME[p]} returned an error (${res.status}). ${text.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

/** Lists a folder (Dropbox and OneDrive; Google Drive uses Google's own file picker). */
export async function listFolder(userId: string, p: Provider, folder: string, query: string): Promise<CloudItem[]> {
  const access = await accessToken(userId, p);
  if (p === "dropbox") {
    type DbxEntry = { ".tag": string; id: string; name: string; path_lower: string; size?: number; server_modified?: string };
    let entries: DbxEntry[];
    if (query.trim()) {
      const r = await call<{ matches: { metadata: { metadata: DbxEntry } }[] }>(p, "https://api.dropboxapi.com/2/files/search_v2", access, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), options: { max_results: 100 } }),
      });
      entries = r.matches.map((m) => m.metadata.metadata);
    } else {
      const r = await call<{ entries: DbxEntry[] }>(p, "https://api.dropboxapi.com/2/files/list_folder", access, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: folder || "", limit: 500 }),
      });
      entries = r.entries;
    }
    return entries
      .filter((e) => e[".tag"] === "folder" || importable(e.name))
      .map((e) => ({ id: e[".tag"] === "folder" ? e.path_lower : e.id, name: e.name, folder: e[".tag"] === "folder", size: e.size, modified: e.server_modified }));
  }
  if (p === "onedrive") {
    type GItem = { id: string; name: string; size?: number; folder?: unknown; file?: { mimeType?: string }; lastModifiedDateTime?: string };
    const sel = "$select=id,name,size,folder,file,lastModifiedDateTime&$top=500";
    const url = query.trim()
      ? `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(query.trim().replace(/'/g, "''"))}')?${sel}`
      : folder
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folder)}/children?${sel}`
        : `https://graph.microsoft.com/v1.0/me/drive/root/children?${sel}`;
    const r = await call<{ value: GItem[] }>(p, url, access);
    return r.value
      .filter((e) => e.folder || importable(e.name))
      .map((e) => ({ id: e.id, name: e.name, folder: Boolean(e.folder), size: e.size, modified: e.lastModifiedDateTime, mime: e.file?.mimeType }));
  }
  throw badRequest("Use the Google Drive picker to choose files.");
}

const GOOGLE_EXPORT: Record<string, [string, string]> = {
  "application/vnd.google-apps.document": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  "application/vnd.google-apps.presentation": ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
};

/** Downloads one file. Google Docs, Sheets and Slides come down as Word, Excel and PowerPoint. */
export async function download(userId: string, p: Provider, fileId: string, maxBytes: number): Promise<{ name: string; data: Buffer }> {
  const access = await accessToken(userId, p);
  const tooBig = (size?: number) => {
    if (size && size > maxBytes) throw badRequest(`This file is larger than your plan's ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  };
  let res: Response;
  let name = "Document";
  if (p === "google") {
    const meta = await call<{ name: string; mimeType: string; size?: string }>(p, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size&supportsAllDrives=true`, access);
    const exp = GOOGLE_EXPORT[meta.mimeType];
    name = exp ? meta.name.replace(/\.[^.]*$/, "") + exp[1] : meta.name;
    tooBig(Number(meta.size) || undefined);
    const url = exp
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exp[0])}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    res = await fetch(url, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(120000) });
  } else if (p === "dropbox") {
    res = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "dropbox-api-arg": asciiJson({ path: fileId }) },
      signal: AbortSignal.timeout(120000),
    });
    const meta = res.headers.get("dropbox-api-result");
    if (meta) {
      const m = JSON.parse(meta) as { name: string; size?: number };
      name = m.name;
      tooBig(m.size);
    }
  } else {
    const meta = await call<{ name: string; size?: number }>(p, `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}?$select=name,size`, access);
    name = meta.name;
    tooBig(meta.size);
    res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/content`, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(120000) });
  }
  if (!res.ok) throw new HttpError(502, `${PROVIDER_NAME[p]} couldn't send the file (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  tooBig(data.length);
  return { name, data };
}

const FOLDER = "pdftek";

/** JSON for an HTTP header: header values must be ASCII, so other characters become \\uXXXX escapes. */
const asciiJson = (o: unknown) => JSON.stringify(o).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** Saves a file to the person's cloud storage (in a "pdftek" folder) and returns a link to it. */
export async function upload(userId: string, p: Provider, name: string, data: Buffer, mime: string): Promise<{ url: string | null; location: string }> {
  const access = await accessToken(userId, p);
  if (p === "google") {
    const boundary = `pdftek${token(8)}`;
    const meta = JSON.stringify({ name, mimeType: mime });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await call<{ id: string; webViewLink?: string }>(p, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", access, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
    return { url: r.webViewLink ?? `https://drive.google.com/file/d/${r.id}/view`, location: "My Drive" };
  }
  if (p === "dropbox") {
    const r = await call<{ path_display: string }>(p, "https://content.dropboxapi.com/2/files/upload", access, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "dropbox-api-arg": asciiJson({ path: `/${FOLDER}/${name}`, mode: "add", autorename: true }) },
      body: new Uint8Array(data),
    });
    const folder = r.path_display.split("/").slice(0, -1).join("/") || "/";
    return { url: `https://www.dropbox.com/home${encodeURI(folder)}`, location: `Dropbox ${folder}` };
  }
  const r = await call<{ webUrl?: string }>(p, `https://graph.microsoft.com/v1.0/me/drive/root:/${FOLDER}/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`, access, {
    method: "PUT",
    headers: { "content-type": mime },
    body: new Uint8Array(data),
  });
  return { url: r.webUrl ?? null, location: `OneDrive /${FOLDER}` };
}

/** For Google's file picker in the browser: the API key, project number and a fresh access token. */
export async function pickerConfig(userId: string) {
  return { apiKey: env("GOOGLE_API_KEY"), appId: env("GOOGLE_APP_ID") || env("GOOGLE_CLIENT_ID").split("-")[0], token: await accessToken(userId, "google") };
}
