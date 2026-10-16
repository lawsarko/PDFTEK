import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, isSitePath } from "./lib/i18n/locales";

const YEAR = 60 * 60 * 24 * 365;

/**
 * 1. Keeps people on one address. When APP_URL is a custom domain (e.g. https://pdftek.com), visits to
 *    the Render address (*.onrender.com) are sent there, so sign-ins and purchases live under a single
 *    domain's cookies. API calls are left alone: Stripe webhooks must not be redirected.
 * 2. Languages. English is the default: pdftek.com/pricing is always English, and /es/pricing is
 *    the Spanish page. The app (/app/…) has one address and shows the language of the website
 *    page the visitor came from.
 */
export function middleware(req: NextRequest) {
  const canonical = canonicalRedirect(req);
  if (canonical) return canonical;

  const { pathname, search } = req.nextUrl;
  const seg = pathname.split("/")[1]?.toLowerCase() ?? "";
  const saved = req.cookies.get(LOCALE_COOKIE)?.value;
  const remember = (res: NextResponse, code: string) => {
    if (saved !== code) res.cookies.set(LOCALE_COOKIE, code, { path: "/", maxAge: YEAR, sameSite: "lax" });
    return res;
  };

  // An address with a language prefix.
  if (isLocale(seg)) {
    const rest = pathname.slice(seg.length + 1) || "/";
    if (seg === DEFAULT_LOCALE || !isSitePath(rest)) {
      // /en/… is just the root address; the app and links have no language prefix.
      return remember(NextResponse.redirect(new URL(rest + search, req.url), 308), seg);
    }
    const url = req.nextUrl.clone();
    url.pathname = rest;
    const headers = new Headers(req.headers);
    headers.set(LOCALE_HEADER, seg);
    return remember(NextResponse.rewrite(url, { request: { headers } }), seg);
  }

  // A website address without a prefix is always English (pdftek.com's default language). Opening
  // it also makes English the language the app follows, so the site and app stay consistent.
  const headers = new Headers(req.headers);
  if (isSitePath(pathname)) {
    headers.set(LOCALE_HEADER, DEFAULT_LOCALE);
    const res = NextResponse.next({ request: { headers } });
    // Background link prefetches aren't visits, so they leave the choice alone.
    const prefetch = req.headers.has("next-router-prefetch") || req.headers.get("purpose") === "prefetch";
    return req.method === "GET" && !prefetch && saved && saved !== DEFAULT_LOCALE ? remember(res, DEFAULT_LOCALE) : res;
  }
  headers.set(LOCALE_HEADER, isLocale(saved) ? saved : DEFAULT_LOCALE);
  return NextResponse.next({ request: { headers } });
}

function canonicalRedirect(req: NextRequest) {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return null;
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return null;
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host.endsWith(".onrender.com") || canonical.hostname.endsWith(".onrender.com") || host === canonical.host) return null;
  return NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, canonical.origin), 308);
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon|icon|apple-touch-icon|manifest|robots.txt|sitemap.xml|llms.txt|pdf.worker).*)"],
};
