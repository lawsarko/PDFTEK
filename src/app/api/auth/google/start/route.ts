import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/http";
import { sbAuthorizeUrl, supabaseEnabled } from "@/lib/supabase";

const GOOGLE_COOKIE = "pdftek_google";

/** "Continue with Google": hands off to Supabase, which talks to Google and returns to the callback. */
export async function GET(req: Request) {
  if (!supabaseEnabled()) return new Response(null, { status: 303, headers: { Location: "/login" } });
  const origin = publicOrigin(req);
  const next = new URL(req.url).searchParams.get("next") ?? "";
  const { url, verifier } = sbAuthorizeUrl("google", `${origin}/api/auth/google/callback`);
  const jar = await cookies();
  jar.set(GOOGLE_COOKIE, JSON.stringify({ verifier, next: next.startsWith("/") && !next.startsWith("//") ? next : "" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    path: "/api/auth/google",
    maxAge: 600,
  });
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
}
