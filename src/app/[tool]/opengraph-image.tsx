import { OG_SIZE, ogImage } from "@/lib/og";
import { SEO_TOOLS, SEO_TOOL_BY_SLUG } from "@/lib/seo-tools";

export const alt = "PDFTEK PDF tool";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SEO_TOOLS.map((t) => ({ tool: t.slug }));
}

export default async function Image({ params }: { params: Promise<{ tool: string }> }) {
  const t = SEO_TOOL_BY_SLUG.get((await params).tool);
  return ogImage(t?.h1 ?? "PDF tools", t ? t.lead.split(". ")[0] + "." : "Free online PDF tools.");
}
