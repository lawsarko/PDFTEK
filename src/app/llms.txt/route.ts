import { ACCESS_NOTE, SEO_CATEGORIES, SEO_TOOLS, siteUrl } from "@/lib/seo-tools";
import { FREE_LIMITS, PRODUCTS, usd } from "@/lib/plans";
import { LOCALES, localizePath } from "@/lib/i18n/locales";

/** llms.txt: a plain summary of the site for AI assistants (https://llmstxt.org). */
export const dynamic = "force-static";

export function GET() {
  const base = siteUrl();
  const lines = [
    "# PDFTEK",
    "",
    "> PDFTEK is an online PDF workbench: convert PDFs to and from Word, Excel, PowerPoint and images, turn bank statements, invoices and receipts into Excel or CSV, bulk-convert many PDFs at once, merge, split, compress, rotate, protect, unlock, OCR, edit, fill forms with AI, e-sign, read aloud, and ask AI questions about PDFs with page citations. It runs in any web browser, in 26 languages; most tools are free without an account.",
    "",
    "## Best for",
    "",
    `- Converting PDF bank and credit card statements to Excel or CSV for QuickBooks, Xero and Sage, with every statement reconciled against its opening and closing balances: ${base}/bank-statement-to-excel and ${base}/bank-statement-to-csv`,
    `- Extracting invoices and receipts (vendor, dates, line items, tax, totals) into a spreadsheet for accounts payable and expenses: ${base}/invoice-to-excel and ${base}/receipt-to-excel`,
    `- Converting many PDFs to Word or Excel in one batch (ZIP download): ${base}/bulk-pdf-converter`,
    `- Filling any PDF form, including scans, with AI: ${base}/fill-pdf-form`,
    `- Everyday PDF tasks for free without signing up: ${base}/tools`,
    "",
    "## Pricing",
    "",
    `- Free: ${FREE_LIMITS.guest.tasksPerDay} tasks per day without an account, ${FREE_LIMITS.free.tasksPerDay} with a free account; files up to ${FREE_LIMITS.free.maxFileMb} MB, ${FREE_LIMITS.free.maxFiles} at a time; no watermark.`,
    `- Day Pass: ${usd(PRODUCTS.pass.cents)} one time for 24 hours of everything (editing, e-signatures, read aloud, unlimited tasks, 100 MB files) plus 50 AI credits. No subscription.`,
    `- Pro: ${usd(PRODUCTS.pro_month.cents)}/month or ${usd(PRODUCTS.pro_year.cents)}/year, with 400 AI credits a month.`,
    `- Team: ${usd(PRODUCTS.team_month.cents)}/month for unlimited people, with 1,500 AI credits a month (Day Pass and Pro allow up to 5 people).`,
    `- AI credits (pay as you go, never expire): 250 for ${usd(PRODUCTS.credits_250.cents)}, 900 for ${usd(PRODUCTS.credits_900.cents)}, 3,000 for ${usd(PRODUCTS.credits_3000.cents)}.`,
    `- Details: ${base}/pricing`,
    "",
    ...SEO_CATEGORIES.flatMap((c) => [
      `## ${c}`,
      "",
      ...SEO_TOOLS.filter((t) => t.category === c).map((t) => `- [${t.name}](${base}/${t.slug}): ${t.description} ${ACCESS_NOTE[t.access]}`),
      "",
    ]),
    "## Languages",
    "",
    `The whole site is available in ${LOCALES.length} languages. English is at the root; other languages use a prefix, e.g. ${base}${localizePath("/merge-pdf", "es")} (Spanish) or ${base}${localizePath("/bank-statement-to-excel", "fr")} (French).`,
    "",
    ...LOCALES.map((l) => `- ${l.english} (${l.name}): ${base}${localizePath("/", l.code) === "/" ? "" : localizePath("/", l.code)}`),
    "",
    "## Privacy",
    "",
    "- Files are transferred over HTTPS, kept in the user's private workspace, and never used to train AI. Files from sessions without an account are deleted after 24 hours.",
    `- Privacy policy: ${base}/privacy`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
