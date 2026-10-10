import "server-only";
import crypto from "node:crypto";

/**
 * "Sign in with Google" (OpenID Connect, authorization-code flow with PKCE). No SDK needed: the ID
 * token comes straight from Google's token endpoint over TLS, so its claims can be trusted after
 * checking audience, issuer, expiry and email verification.
 */
export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export const GOOGLE_COOKIE = "pdftek_google";

export function googleAuthUrl(origin: string) {
  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, verifier };
}

export type GoogleProfile = { sub: string; email: string; name: string };

export async function exchangeGoogleCode(origin: string, code: string, verifier: string): Promise<GoogleProfile> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { id_token?: string; error_description?: string };
  if (!res.ok || !data.id_token) throw new Error(data.error_description ?? `Google sign-in failed (${res.status})`);
  const claims = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8")) as {
    iss: string;
    aud: string;
    exp: number;
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("Google sign-in: wrong audience.");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("Google sign-in: wrong issuer.");
  if (claims.exp * 1000 < Date.now()) throw new Error("Google sign-in: expired token.");
  if (!claims.email || !claims.email_verified) throw new Error("Your Google account's email isn't verified.");
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name || claims.email.split("@")[0] };
}
