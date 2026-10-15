import { dictFor, i18nVersion } from "@/lib/i18n/server";
import { isLocale } from "@/lib/i18n/locales";

type P = { params: Promise<{ locale: string }> };

/** Every translation for a language, for the in-app translator (cached by the browser). */
export async function GET(req: Request, { params }: { params: P["params"] }) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "en") return Response.json({ v: 0, exact: {}, patterns: [] });
  const v = i18nVersion(locale);
  const etag = `"${locale}-${v}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  const { dict } = dictFor(locale);
  return Response.json({ v, ...dict }, { headers: { etag, "cache-control": "public, max-age=120, stale-while-revalidate=86400" } });
}
