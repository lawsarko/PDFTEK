import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps people on one address. When APP_URL is a custom domain (e.g. https://pdftek.com), visits to
 * the Render address (*.onrender.com) are sent there, so sign-ins and purchases live under a single
 * domain's cookies. API calls are left alone: Stripe webhooks must not be redirected.
 */
export function middleware(req: NextRequest) {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return NextResponse.next();
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return NextResponse.next();
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host.endsWith(".onrender.com") || canonical.hostname.endsWith(".onrender.com") || host === canonical.host) {
    return NextResponse.next();
  }
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, canonical.origin);
  return NextResponse.redirect(target, 308);
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon|icon|apple-touch-icon|manifest|robots.txt|sitemap.xml|llms.txt).*)"],
};
