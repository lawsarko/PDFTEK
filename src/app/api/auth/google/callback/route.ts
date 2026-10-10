import { cookies } from "next/headers";
import { sbExchangeCode } from "@/lib/supabase";
import { signInSupabaseUser } from "@/lib/identity";

const COOKIE = "pdftek_google";
const go = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

/** Supabase sends the browser back here with a one-time code after Google sign-in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/api/auth/google" });
  let stash: { verifier: string; next: string } | null = null;
  try {
    stash = saved ? JSON.parse(saved) : null;
  } catch {}
  const code = url.searchParams.get("code");
  if (!stash || !code) {
    if (url.searchParams.get("error")) console.error("[pdftek] Google sign-in refused:", url.searchParams.get("error_description"));
    return go("/login?error=google");
  }
  try {
    const session = await sbExchangeCode(code, stash.verifier);
    const { workspaceId } = await signInSupabaseUser(req, session.user);
    return go(stash.next || `/app/${workspaceId}`);
  } catch (err) {
    console.error("[pdftek] Google sign-in failed", err instanceof Error ? err.message : err);
    return go(`/login?error=${err instanceof Error && /already exists/.test(err.message) ? "google_exists" : "google"}`);
  }
}
