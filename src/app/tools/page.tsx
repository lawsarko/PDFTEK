import Link from "next/link";
import type { Metadata } from "next";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { JsonLd } from "@/components/json-ld";
import { SEO_CATEGORIES, SEO_TOOLS, siteUrl } from "@/lib/seo-tools";

export const metadata: Metadata = {
  title: { absolute: "All PDF Tools – Convert, Merge, Compress, Edit & Sign | PDFTEK" },
  description:
    "Every PDF tool in one place: PDF to Word, Excel, JPG and back, merge, split, compress, rotate, protect, unlock, OCR, edit, sign and chat with PDFs. Free online.",
  alternates: { canonical: "/tools" },
};

export default function ToolsHub() {
  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "PDFTEK PDF tools",
          itemListElement: SEO_TOOLS.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: `${siteUrl()}/${t.slug}` })),
        }}
      />
      <MarketingNav signedIn={false} />
      <section className="mk-section" style={{ textAlign: "center", paddingBottom: 24 }}>
        <div className="eyebrow">PDF tools</div>
        <h1 className="mk-h2" style={{ fontSize: "clamp(34px, 5vw, 54px)", marginTop: 10 }}>
          Every PDF tool you need, in one place
        </h1>
        <p className="mk-sub" style={{ margin: "14px auto 0" }}>
          Convert, organize, compress, secure, edit, sign and understand PDFs online. Most tools are free with no sign-up and no watermark.
        </p>
      </section>
      {SEO_CATEGORIES.map((c) => (
        <section key={c} className="mk-section" style={{ paddingTop: 24, paddingBottom: 24 }}>
          <h2 className="mk-h2" style={{ fontSize: 24 }}>{c}</h2>
          <div className="seo-grid">
            {SEO_TOOLS.filter((t) => t.category === c).map((t) => (
              <Link key={t.slug} href={`/${t.slug}`} className="seo-tile">
                <b>{t.name}</b>
                <span>{t.description.split(". ")[0]}.</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <MarketingFooter />
    </div>
  );
}
