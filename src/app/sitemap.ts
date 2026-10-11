import type { MetadataRoute } from "next";
import { SEO_TOOLS, siteUrl } from "@/lib/seo-tools";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/tools`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    ...SEO_TOOLS.map((t) => ({ url: `${base}/${t.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.1 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.1 },
  ];
}
