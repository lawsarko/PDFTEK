import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, isSitePath, localizePath } from "./lib/i18n/locales";

const YEAR = 60 * 60 * 24 * 365;

/**
 * 1. Keeps people on one address. When APP_URL is a custom domain (e.g. https://pdftek.com), visits to
 *    the Render address (*.onrender.com) are sent there, so sign-ins and purchases live under a single
 *    domain's cookies. API calls are left alone: Stripe webhooks must not be redirected.
 * 2. Languages. /es/pricing shows /pricing in Spanish (and remembers the choice); someone who picked
 *    a language and opens an English address of the website is taken to their language's address.
 *    The app (/app/…) has one address and follows the remembered choice.
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

  // A website address without a prefix, from someone who chose another language.
  if (isLocale(saved) && saved !== DEFAULT_LOCALE && isSitePath(pathname) && req.method === "GET") {
    return NextResponse.redirect(new URL(localizePath(pathname, saved) + search, req.url), 307);
  }

  const headers = new Headers(req.headers);
  headers.set(LOCALE_HEADER, isLocale(saved) && !isSitePath(pathname) ? saved : DEFAULT_LOCALE);
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
