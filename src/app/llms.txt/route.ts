import { ACCESS_NOTE, SEO_CATEGORIES, SEO_TOOLS, siteUrl } from "@/lib/seo-tools";
import { FREE_LIMITS, PRODUCTS, usd } from "@/lib/plans";

/** llms.txt: a plain summary of the site for AI assistants (https://llmstxt.org). */
export const dynamic = "force-static";

export function GET() {
  const base = siteUrl();
  const lines = [
    "# PDFTEK",
    "",
    "> PDFTEK is an online PDF workbench: convert PDFs to and from Word, Excel, PowerPoint and images, merge, split, compress, rotate, protect, unlock, OCR, edit, e-sign, read aloud, and ask AI questions about PDFs with page citations. It runs in any web browser; most tools are free without an account.",
    "",
    "## Pricing",
    "",
    `- Free: ${FREE_LIMITS.guest.tasksPerDay} tasks per day without an account, ${FREE_LIMITS.free.tasksPerDay} with a free account; files up to ${FREE_LIMITS.free.maxFileMb} MB, ${FREE_LIMITS.free.maxFiles} at a time; no watermark.`,
    `- Day Pass: ${usd(PRODUCTS.pass.cents)} one time for 24 hours of everything (editing, e-signatures, read aloud, unlimited tasks, 100 MB files) plus 50 AI credits. No subscription.`,
    `- Pro: ${usd(PRODUCTS.pro_month.cents)}/month or ${usd(PRODUCTS.pro_year.cents)}/year, with 400 AI credits a month.`,
    `- Team: ${usd(PRODUCTS.team_month.cents)}/month for up to 5 people, with 1,500 AI credits a month.`,
    `- AI credits (pay as you go, never expire): 250 for ${usd(PRODUCTS.credits_250.cents)}, 900 for ${usd(PRODUCTS.credits_900.cents)}, 3,000 for ${usd(PRODUCTS.credits_3000.cents)}.`,
    `- Details: ${base}/pricing`,
    "",
    ...SEO_CATEGORIES.flatMap((c) => [
      `## ${c}`,
      "",
      ...SEO_TOOLS.filter((t) => t.category === c).map((t) => `- [${t.name}](${base}/${t.slug}): ${t.description} ${ACCESS_NOTE[t.access]}`),
      "",
    ]),
    "## Privacy",
    "",
    "- Files are transferred over HTTPS, kept in the user's private workspace, and never used to train AI. Files from sessions without an account are deleted after 24 hours.",
    `- Privacy policy: ${base}/privacy`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
