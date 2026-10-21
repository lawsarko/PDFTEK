import type { MetadataRoute } from "next";
import { SEO_TOOLS, siteUrl } from "@/lib/seo-tools";
import { LOCALES, localizePath } from "@/lib/i18n/locales";
import { readyLocales } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

/** Every public page in every finished language, each listing its translations (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const ready = readyLocales();
  const langs = LOCALES.filter((l) => ready.has(l.code));
  const now = new Date();
  const pages: [string, Freq, number][] = [
    ["/", "weekly", 1],
    ["/tools", "weekly", 0.9],
    ...SEO_TOOLS.map((t): [string, Freq, number] => [`/${t.slug}`, "monthly", 0.8]),
    ["/pricing", "monthly", 0.7],
    ["/how-it-works", "monthly", 0.6],
    ["/contact", "yearly", 0.4],
    ["/signup", "yearly", 0.3],
    ["/terms", "yearly", 0.1],
    ["/privacy", "yearly", 0.1],
  ];
  const url = (path: string, code: string) => {
    const p = localizePath(path, code);
    return p === "/" ? base : `${base}${p}`;
  };
  return pages.flatMap(([path, changeFrequency, priority]) => {
    const languages: Record<string, string> = Object.fromEntries(langs.map((l) => [l.tag, url(path, l.code)]));
    languages["x-default"] = url(path, "en");
    return langs.map((l) => ({
      url: url(path, l.code),
      lastModified: now,
      changeFrequency,
      priority: l.code === "en" ? priority : Math.round(priority * 0.9 * 10) / 10,
      alternates: { languages },
    }));
  });
}
