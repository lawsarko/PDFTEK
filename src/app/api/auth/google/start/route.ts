import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/http";
import { GOOGLE_COOKIE, googleAuthUrl, googleEnabled } from "@/lib/google-auth";

export async function GET(req: Request) {
  if (!googleEnabled()) return new Response(null, { status: 303, headers: { Location: "/login" } });
  const next = new URL(req.url).searchParams.get("next") ?? "";
  const { url, state, verifier } = googleAuthUrl(publicOrigin(req));
  const jar = await cookies();
  jar.set(GOOGLE_COOKIE, JSON.stringify({ state, verifier, next: next.startsWith("/") && !next.startsWith("//") ? next : "" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: publicOrigin(req).startsWith("https"),
    path: "/api/auth/google",
    maxAge: 600,
  });
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
}
