import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { JsonLd } from "@/components/json-ld";
import { I } from "@/components/icons";
import { ACCESS_NOTE, SEO_TOOLS, SEO_TOOL_BY_SLUG, siteUrl } from "@/lib/seo-tools";
import { PRODUCTS } from "@/lib/plans";

type P = { params: Promise<{ tool: string }> };

// One static page per tool: fast for visitors and fully readable by crawlers.
export const dynamicParams = false;
export function generateStaticParams() {
  return SEO_TOOLS.map((t) => ({ tool: t.slug }));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const t = SEO_TOOL_BY_SLUG.get((await params).tool);
  if (!t) return {};
  return {
    title: { absolute: `${t.title} | PDFTEK` },
    description: t.description,
    alternates: { canonical: `/${t.slug}` },
    openGraph: { title: t.title, description: t.description, url: `/${t.slug}`, type: "website", siteName: "PDFTEK" },
    twitter: { card: "summary_large_image", title: t.title, description: t.description },
  };
}

export default async function ToolPage({ params }: P) {
  const t = SEO_TOOL_BY_SLUG.get((await params).tool);
  if (!t) notFound();
  const url = `${siteUrl()}/${t.slug}`;
  const related = t.related.map((s) => SEO_TOOL_BY_SLUG.get(s)!).filter(Boolean);
  const free = t.access === "free";
  const price = t.access === "member" ? PRODUCTS.pass.cents / 100 : 0;

  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebApplication",
              "@id": `${url}#app`,
              name: `PDFTEK ${t.name}`,
              url,
              description: t.description,
              applicationCategory: "BusinessApplication",
              operatingSystem: "Any (web browser)",
              browserRequirements: "Requires JavaScript and a modern web browser",
              isAccessibleForFree: free,
              offers: { "@type": "Offer", price: price.toFixed(2), priceCurrency: "USD" },
              featureList: t.benefits,
              publisher: { "@id": `${siteUrl()}/#org` },
            },
            {
              "@type": "HowTo",
              name: howTo(t.h1),
              description: t.lead,
              tool: { "@type": "HowToTool", name: "PDFTEK (web browser)" },
              step: t.steps.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text, url: `${url}#step-${i + 1}` })),
            },
            {
              "@type": "FAQPage",
              mainEntity: t.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "PDFTEK", item: siteUrl() },
                { "@type": "ListItem", position: 2, name: "PDF tools", item: `${siteUrl()}/tools` },
                { "@type": "ListItem", position: 3, name: t.name, item: url },
              ],
            },
          ],
        }}
      />
      <MarketingNav signedIn={false} />

      <section className="mk-hero" style={{ paddingTop: 56 }}>
        <div className="mk-section" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <nav aria-label="Breadcrumb" className="crumbs">
            <Link href="/">PDFTEK</Link> <span>›</span> <Link href="/tools">PDF tools</Link> <span>›</span> <span aria-current="page">{t.name}</span>
          </nav>
          <h1 style={{ fontSize: "clamp(36px, 6vw, 64px)" }}>{t.h1}</h1>
          <p className="lead">{t.lead}</p>
          <div className="mk-cta">
            <Link prefetch={false} className="btn btn-primary btn-lg btn-glow" href={`/go/${t.go}`}>
              <I.upload size={16} /> {t.go === "scan-to-pdf" ? "Start scanning" : `Start: ${t.name}`}
            </Link>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            {free ? "Free · no sign-up · no watermark" : t.access === "member" ? "Day Pass or Pro" : "Pay as you go with AI credits"}
          </p>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 40, paddingBottom: 40, maxWidth: 980 }}>
        <h2 className="mk-h2" style={{ fontSize: 28 }}>{howTo(t.h1)}</h2>
        <ol className="seo-steps">
          {t.steps.map(([name, text], i) => (
            <li key={name} id={`step-${i + 1}`}>
              <span className="seo-step-n">{i + 1}</span>
              <div>
                <h3>{name}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mk-section" style={{ paddingTop: 40, paddingBottom: 40, maxWidth: 980 }}>
        <div className="mk-split" style={{ alignItems: "start" }}>
          <div>
            <h2 className="mk-h2" style={{ fontSize: 28 }}>Why PDFTEK for {t.name}</h2>
            <ul className="mk-list">
              {t.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="mk-card">
            <h3 style={{ marginTop: 0 }}>Price</h3>
            <p>{ACCESS_NOTE[t.access]}</p>
            <p style={{ marginTop: 10 }}>
              <Link href="/pricing">See all plans →</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="mk-section faq" style={{ paddingTop: 40, maxWidth: 820 }}>
        <h2 className="mk-h2" style={{ fontSize: 28 }}>{t.name}: frequently asked questions</h2>
        {t.faq.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <section className="mk-section" style={{ paddingTop: 20 }}>
        <h2 className="mk-h2" style={{ fontSize: 24 }}>Related PDF tools</h2>
        <div className="seo-grid">
          {related.map((r) => (
            <Link key={r.slug} href={`/${r.slug}`} className="seo-tile">
              <b>{r.name}</b>
              <span>{r.description.split(". ")[0]}.</span>
            </Link>
          ))}
        </div>
        <p style={{ marginTop: 18 }}>
          <Link href="/tools">All PDF tools →</Link>
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
