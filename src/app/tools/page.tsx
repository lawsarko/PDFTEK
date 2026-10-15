import Link from "next/link";
import type { Metadata } from "next";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { JsonLd } from "@/components/json-ld";
import { SEO_CATEGORIES, SEO_TOOLS, siteUrl } from "@/lib/seo-tools";
import { alternatesFor, getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return {
    title: { absolute: `${t("All PDF Tools – Convert, Merge, Compress, Edit & Sign")} | PDFTEK` },
    description: t("Every PDF tool in one place: PDF to Word, Excel, JPG and back, merge, split, compress, rotate, protect, unlock, OCR, edit, sign and chat with PDFs. Free online."),
    alternates: alternatesFor("/tools", locale),
  };
}

export default async function ToolsHub() {
  const { t, lp } = await getI18n();
  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: t("PDFTEK PDF tools"),
          itemListElement: SEO_TOOLS.map((tool, i) => ({ "@type": "ListItem", position: i + 1, name: t(tool.name), url: `${siteUrl()}${lp(`/${tool.slug}`)}` })),
        }}
      />
      <MarketingNav signedIn={false} />
      <section className="mk-section" style={{ textAlign: "center", paddingBottom: 24 }}>
        <div className="eyebrow">{t("PDF tools")}</div>
        <h1 className="mk-h2" style={{ fontSize: "clamp(34px, 5vw, 54px)", marginTop: 10 }}>
          {t("Every PDF tool you need, in one place")}
        </h1>
        <p className="mk-sub" style={{ margin: "14px auto 0" }}>
          {t("Convert, organize, compress, secure, edit, sign and understand PDFs online. Most tools are free with no sign-up and no watermark.")}
        </p>
      </section>
      {SEO_CATEGORIES.map((c) => (
        <section key={c} className="mk-section" style={{ paddingTop: 24, paddingBottom: 24 }}>
          <h2 className="mk-h2" style={{ fontSize: 24 }}>{t(c)}</h2>
          <div className="seo-grid">
            {SEO_TOOLS.filter((tool) => tool.category === c).map((tool) => (
              <Link key={tool.slug} href={lp(`/${tool.slug}`)} className="seo-tile">
                <b>{t(tool.name)}</b>
                <span>{t(`${tool.description.split(". ")[0]}.`)}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <MarketingFooter />
    </div>
  );
}
