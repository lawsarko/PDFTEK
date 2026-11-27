import "server-only";
import crypto from "node:crypto";

/**
 * Supabase Auth (GoTrue) over its REST API: passwords, Google sign-in, and the confirmation and
 * password-reset emails all live in Supabase. pdftek keeps its own session cookie and data; local
 * users are linked to Supabase users by `users.supabase_id`.
 *
 * Email links use Supabase's implicit flow (tokens arrive in the URL fragment of /auth/confirm), so
 * they work on any device. Google uses PKCE with the verifier kept in a short-lived cookie.
 */

export type SbUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: { name?: string; full_name?: string };
  identities?: unknown[];
};

export class SupabaseError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const url = () => process.env.SUPABASE_URL?.replace(/\/+$/, "") ?? "";
const publicKey = () => process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
const secretKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

export function supabaseEnabled() {
  return Boolean(url() && publicKey());
}

/** The admin API (needs the secret key) moves accounts from before Supabase over on their next sign-in. */
export function supabaseAdminEnabled() {
  return supabaseEnabled() && Boolean(secretKey());
}

async function gotrue<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; admin?: boolean; query?: Record<string, string> } = {},
): Promise<T> {
  const key = opts.admin ? secretKey() : publicKey();
  const target = new URL(`${url()}/auth/v1${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) target.searchParams.set(k, v);
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  // New-style secret keys are only accepted as a bearer token when it equals the apikey header.
  if (opts.token || opts.admin) headers.authorization = `Bearer ${opts.token ?? key}`;
  const res = await fetch(target, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(data.error_code ?? data.error ?? res.status);
    const message = String(data.msg ?? data.message ?? data.error_description ?? data.error ?? "Supabase request failed");
    throw new SupabaseError(res.status, code, message);
  }
  return data as T;
}

type Session = { access_token: string; user: SbUser };

export function displayName(u: SbUser, fallback?: string) {
  return (u.user_metadata?.full_name || u.user_metadata?.name || fallback || u.email?.split("@")[0] || "User").slice(0, 80);
}

/**
 * Creates the Supabase user. With "Confirm email" on, Supabase emails a link and returns no session;
 * for an address that's already registered it returns a stand-in user with no identities.
 */
export async function sbSignUp(email: string, password: string, name: string, redirectTo: string) {
  const r = await gotrue<Partial<Session> & SbUser & { user?: SbUser }>("/signup", {
    body: { email, password, data: { name, full_name: name } },
    query: { redirect_to: redirectTo },
  }).catch((e) => {
    if (e instanceof SupabaseError && /already|exists/i.test(e.code + e.message)) return null;
    throw e;
  });
  if (!r) return { exists: true as const };
  const user = (r.user ?? r) as SbUser;
  if (Array.isArray(user.identities) && user.identities.length === 0) return { exists: true as const };
  return { exists: false as const, user, confirmed: Boolean(user.email_confirmed_at) };
}

export async function sbAdminCreateUser(email: string, password: string | null, name: string, confirmed: boolean): Promise<SbUser> {
  return gotrue<SbUser>("/admin/users", {
    admin: true,
    body: { email, ...(password ? { password } : {}), email_confirm: confirmed, user_metadata: { name, full_name: name } },
  });
}

export async function sbPasswordLogin(email: string, password: string): Promise<Session> {
  return gotrue<Session>("/token", { body: { email, password }, query: { grant_type: "password" } });
}

export async function sbUserFromToken(accessToken: string): Promise<SbUser> {
  return gotrue<SbUser>("/user", { token: accessToken });
}

export async function sbUpdatePassword(accessToken: string, password: string) {
  return gotrue<SbUser>("/user", { method: "PUT", token: accessToken, body: { password } });
}

/** Emails a password-reset link that opens /auth/confirm. */
export async function sbRecover(email: string, redirectTo: string) {
  await gotrue("/recover", { body: { email }, query: { redirect_to: redirectTo } });
}

/** Emails a one-time sign-in link; creates the Supabase user if needed. */
export async function sbMagicLink(email: string, redirectTo: string) {
  await gotrue("/otp", { body: { email, create_user: true }, query: { redirect_to: redirectTo } });
}

export async function sbResendConfirmation(email: string, redirectTo: string) {
  await gotrue("/resend", { body: { type: "signup", email }, query: { redirect_to: redirectTo } });
}

/** Which sign-in providers are switched on in the Supabase dashboard (cached for a minute). */
let settingsCache: { at: number; google: boolean } | null = null;
export async function sbGoogleEnabled(): Promise<boolean> {
  if (!supabaseEnabled()) return false;
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.google;
  try {
    const s = await gotrue<{ external?: Record<string, boolean> }>("/settings");
    settingsCache = { at: Date.now(), google: Boolean(s.external?.google) };
  } catch {
    settingsCache = { at: Date.now(), google: false };
  }
  return settingsCache.google;
}

export function sbAuthorizeUrl(provider: "google", redirectTo: string) {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const target = new URL(`${url()}/auth/v1/authorize`);
  target.search = new URLSearchParams({
    provider,
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: "s256",
  }).toString();
  return { url: target.toString(), verifier };
}

export async function sbExchangeCode(code: string, verifier: string): Promise<Session> {
  return gotrue<Session>("/token", { body: { auth_code: code, code_verifier: verifier }, query: { grant_type: "pkce" } });
}
