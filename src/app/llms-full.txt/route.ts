import { ACCESS_NOTE, SEO_CATEGORIES, SEO_TOOLS, siteUrl } from "@/lib/seo-tools";
import { PRICING_FAQ } from "@/lib/plans";
import { LOCALES, localizePath } from "@/lib/i18n/locales";

/**
 * llms-full.txt: everything an AI assistant needs to answer questions about PDFTEK accurately,
 * in one plain-text file: every tool's purpose, steps, benefits and FAQ, plus pricing questions.
 */
export const dynamic = "force-static";

export function GET() {
  const base = siteUrl();
  const out: string[] = [
    "# PDFTEK – full reference",
    "",
    `> Online PDF workbench in ${LOCALES.length} languages. Summary: ${base}/llms.txt · Guide: ${base}/how-it-works · Pricing: ${base}/pricing`,
    "",
  ];
  for (const c of SEO_CATEGORIES) {
    out.push(`## ${c}`, "");
    for (const t of SEO_TOOLS.filter((x) => x.category === c)) {
      out.push(`### ${t.name}`, "", `URL: ${base}/${t.slug}`, "", t.lead, "", ACCESS_NOTE[t.access], "", "How to:");
      t.steps.forEach(([h, b], i) => out.push(`${i + 1}. ${h}: ${b}`));
      out.push("", "Why PDFTEK:", ...t.benefits.map((b) => `- ${b}`), "", "Questions:");
      for (const [q, a] of t.faq) out.push(`- Q: ${q}`, `  A: ${a}`);
      out.push("", `Also available in other languages, e.g. ${base}${localizePath(`/${t.slug}`, "es")} (Spanish), ${base}${localizePath(`/${t.slug}`, "fr")} (French).`, "");
    }
  }
  out.push("## Pricing questions", "");
  for (const [q, a] of PRICING_FAQ) out.push(`- Q: ${q}`, `  A: ${a}`);
  out.push("");
  return new Response(out.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
