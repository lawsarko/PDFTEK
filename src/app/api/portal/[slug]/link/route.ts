import { NextResponse } from "next/server";
import { verifyLink } from "@/lib/client-portal";

type P = { params: Promise<{ slug: string }> };

/** One-click sign-in from an email. Back to the portal either way (signed in, or at the sign-in form). */
export async function GET(req: Request, { params }: P) {
  const { slug } = await params;
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const ok = t ? await verifyLink(slug, t) : false;
  // Same host the visitor is on (the firm's own address, or pdftek.com/portal/slug).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const onFirmHost = host.toLowerCase().startsWith(`${slug}.`);
  const back = `${onFirmHost ? "/" : `/portal/${slug}`}${ok ? "" : "?expired=1"}`;
  return NextResponse.redirect(new URL(back, `${req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")}://${host}`), 303);
}
