import "server-only";
import type { Metadata } from "next";
import { LOCALES } from "./i18n/locales";
import { alternatesFor, getI18n } from "./i18n/server";

/**
 * Metadata for a public page in the visitor's language: title and description, canonical URL and
 * hreflang links to its translations, and a link preview (Open Graph / X) that names this page
 * rather than the site in general, which is what search results, chat apps and AI assistants show.
 */
export async function pageMeta(path: string, o: { title: string; description: string; absolute?: boolean; index?: boolean }): Promise<Metadata> {
  const { t, locale, info, lp } = await getI18n();
  const title = t(o.title);
  const description = t(o.description);
  const shown = o.absolute || title.includes("PDFTEK") ? title : `${title} | PDFTEK`;
  return {
    title: o.absolute ? { absolute: shown } : title,
    description,
    alternates: alternatesFor(path, locale),
    openGraph: {
      type: "website",
      siteName: "PDFTEK",
      title: shown,
      description,
      url: lp(path),
      locale: info.tag.replace("-", "_"),
      alternateLocale: LOCALES.filter((l) => l.code !== locale).map((l) => l.tag.replace("-", "_")),
    },
    twitter: { card: "summary_large_image", title: shown, description },
    ...(o.index === false ? { robots: { index: false, follow: true } } : {}),
  };
}
