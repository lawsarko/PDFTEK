import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { JsonLd } from "@/components/json-ld";
import { I } from "@/components/icons";
import { ACCESS_NOTE, SEO_TOOLS, SEO_TOOL_BY_SLUG, siteUrl } from "@/lib/seo-tools";
import { PRODUCTS } from "@/lib/plans";
import { alternatesFor, getI18n } from "@/lib/i18n/server";

type P = { params: Promise<{ tool: string }> };

// One page per tool (rendered per language), fully readable by crawlers.
export const dynamicParams = false;
export function generateStaticParams() {
  return SEO_TOOLS.map((t) => ({ tool: t.slug }));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const tool = SEO_TOOL_BY_SLUG.get((await params).tool);
  if (!tool) return {};
  const { t, locale, lp } = await getI18n();
  const title = t(tool.title);
  const description = t(tool.description);
  return {
    title: { absolute: `${title} | PDFTEK` },
    description,
    alternates: alternatesFor(`/${tool.slug}`, locale),
    openGraph: { title, description, url: lp(`/${tool.slug}`), type: "website", siteName: "PDFTEK" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ToolPage({ params }: P) {
  const tool = SEO_TOOL_BY_SLUG.get((await params).tool);
  if (!tool) notFound();
  const { t, lp, info } = await getI18n();
  const url = `${siteUrl()}${lp(`/${tool.slug}`)}`;
  const related = tool.related.map((s) => SEO_TOOL_BY_SLUG.get(s)!).filter(Boolean);
  const free = tool.access === "free";
  const price = tool.access === "member" ? PRODUCTS.pass.cents / 100 : 0;
  const name = t(tool.name);
  const how = t(howTo(tool.h1));
  const steps = tool.steps.map(([a, b]) => [t(a), t(b)] as const);
  const faq = tool.faq.map(([q, a]) => [t(q), t(a)] as const);
  const benefits = tool.benefits.map((b) => t(b));

  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebApplication",
              "@id": `${url}#app`,
              name: `PDFTEK ${name}`,
              url,
              inLanguage: info.tag,
              description: t(tool.description),
              applicationCategory: "BusinessApplication",
              operatingSystem: "Any (web browser)",
              browserRequirements: "Requires JavaScript and a modern web browser",
              isAccessibleForFree: free,
              offers: { "@type": "Offer", price: price.toFixed(2), priceCurrency: "USD" },
              featureList: benefits,
              publisher: { "@id": `${siteUrl()}/#org` },
            },
            {
              "@type": "HowTo",
              inLanguage: info.tag,
              name: how,
              description: t(tool.lead),
              tool: { "@type": "HowToTool", name: t("PDFTEK (web browser)") },
              step: steps.map(([n, text], i) => ({ "@type": "HowToStep", position: i + 1, name: n, text, url: `${url}#step-${i + 1}` })),
            },
            {
              "@type": "FAQPage",
              inLanguage: info.tag,
              mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "PDFTEK", item: `${siteUrl()}${lp("/")}` },
                { "@type": "ListItem", position: 2, name: t("PDF tools"), item: `${siteUrl()}${lp("/tools")}` },
                { "@type": "ListItem", position: 3, name, item: url },
              ],
            },
          ],
        }}
      />
      <MarketingNav signedIn={false} />

      <section className="mk-hero" style={{ paddingTop: 56 }}>
        <div className="mk-section" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <nav aria-label="Breadcrumb" className="crumbs">
            <Link href={lp("/")}>PDFTEK</Link> <span>›</span> <Link href={lp("/tools")}>{t("PDF tools")}</Link> <span>›</span> <span aria-current="page">{name}</span>
          </nav>
          <h1 style={{ fontSize: "clamp(36px, 6vw, 64px)" }}>{t(tool.h1)}</h1>
          <p className="lead">{t(tool.lead)}</p>
          <div className="mk-cta">
            <Link prefetch={false} className="btn btn-primary btn-lg btn-glow" href={`/go/${tool.go}`}>
              <I.upload size={16} /> {tool.go === "scan-to-pdf" ? t("Start scanning") : t("Start: {name}", { name })}
            </Link>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            {free ? t("Free · no sign-up · no watermark") : tool.access === "member" ? t("Day Pass or Pro") : t("Pay as you go with AI credits")}
          </p>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 40, paddingBottom: 40, maxWidth: 980 }}>
        <h2 className="mk-h2" style={{ fontSize: 28 }}>{how}</h2>
        <ol className="seo-steps">
          {steps.map(([n, text], i) => (
            <li key={i} id={`step-${i + 1}`}>
              <span className="seo-step-n">{i + 1}</span>
              <div>
                <h3>{n}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mk-section" style={{ paddingTop: 40, paddingBottom: 40, maxWidth: 980 }}>
        <div className="mk-split" style={{ alignItems: "start" }}>
          <div>
            <h2 className="mk-h2" style={{ fontSize: 28 }}>{t("Why PDFTEK for {name}", { name })}</h2>
            <ul className="mk-list">
              {benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="mk-card">
            <h3 style={{ marginTop: 0 }}>{t("Price")}</h3>
            <p>{t(ACCESS_NOTE[tool.access])}</p>
            <p style={{ marginTop: 10 }}>
              <Link href={lp("/pricing")}>{t("See all plans →")}</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="mk-section faq" style={{ paddingTop: 40, maxWidth: 820 }}>
        <h2 className="mk-h2" style={{ fontSize: 28 }}>{t("{name}: frequently asked questions", { name })}</h2>
        {faq.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <section className="mk-section" style={{ paddingTop: 20 }}>
        <h2 className="mk-h2" style={{ fontSize: 24 }}>{t("Related PDF tools")}</h2>
        <div className="seo-grid">
          {related.map((r) => (
            <Link key={r.slug} href={lp(`/${r.slug}`)} className="seo-tile">
              <b>{t(r.name)}</b>
              <span>{t(`${r.description.split(". ")[0]}.`)}</span>
            </Link>
          ))}
        </div>
        <p style={{ marginTop: 18 }}>
          <Link href={lp("/tools")}>{t("All PDF tools →")}</Link>
        </p>
      </section>

      <MarketingFooter />
    </div>
  );
}

/** "Merge PDF files" → "How to merge PDF files" (acronyms like "OCR" keep their case). */
function howTo(h1: string) {
  const [first, ...rest] = h1.split(" ");
  const word = first === first.toUpperCase() ? first : first.toLowerCase();
  return `How to ${[word, ...rest].join(" ")}`;
}
