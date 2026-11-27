import Link from "next/link";
import { pageMeta } from "@/lib/seo-meta";
import { currentUser } from "@/lib/auth";
import { MarketingFooter, MarketingNav } from "@/components/marketing";
import { I } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { siteUrl } from "@/lib/seo-tools";
import { getI18n } from "@/lib/i18n/server";
import { CATEGORIES, GUIDES } from "@/lib/help/guides";
import { hasShot, videoFor } from "@/lib/help/media";
import { HelpSearch } from "@/components/help/help-search";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return pageMeta("/help", {
    title: "Help Center – Guides and videos for every PDFTEK feature",
    description: "Step-by-step guides and narrated videos for every PDFTEK feature: converting, editing, e-signatures, Ask AI, client portals, teams and more.",
  });
}

const CAT_ICON: Record<string, React.ReactNode> = {
  start: <I.bolt size={20} />,
  documents: <I.convert size={20} />,
  edit: <I.edit size={20} />,
  sign: <I.sign size={20} />,
  ai: <I.sparkle size={20} />,
  clients: <I.users size={20} />,
  account: <I.gear size={20} />,
};

export default async function HelpCenter() {
  const user = await currentUser();
  const { t, lp } = await getI18n();
  const catTitle = (k: string) => t(CATEGORIES.find((c) => c.key === k)!.title);
  const items = GUIDES.map((g) => ({
    href: lp(`/help/${g.slug}`),
    title: t(g.title),
    summary: t(g.summary),
    category: catTitle(g.category),
    text: g.steps.map((s) => `${t(s.title)} ${t(s.text)}`).join(" "),
    video: !!videoFor(g.slug),
  }));
  const popular = ["getting-started", "convert-from-pdf", "edit-pdf", "request-signatures", "ask-ai", "clients-setup"].map((s) => GUIDES.find((g) => g.slug === s)!);

  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: t("PDFTEK Help Center"),
          url: `${siteUrl()}${lp("/help")}`,
          hasPart: GUIDES.map((g) => ({ "@type": "HowTo", name: t(g.title), url: `${siteUrl()}${lp(`/help/${g.slug}`)}` })),
        }}
      />
      <MarketingNav signedIn={!!user && !user.is_guest} />

      <section className="hc-hero">
        <div className="hc-wrap">
          <div className="eyebrow">{t("Help Center")}</div>
          <h1>{t("How can we help?")}</h1>
          <p className="mk-sub">{t("Short guides and narrated videos for every feature. Search, or pick a topic below.")}</p>
          <HelpSearch items={items} placeholder={t("Search the guides, e.g. sign, convert, clients")} noResults={t("No guide matches. Try another word.")} videoLabel={t("Video")} />
        </div>
      </section>

      <section className="hc-wrap hc-section">
        <h2 className="hc-h2">{t("Most popular")}</h2>
        <div className="hc-popular">
          {popular.map((g) => {
            const shot = g.steps.find((s) => hasShot(s.shot))?.shot;
            return (
              <Link key={g.slug} href={lp(`/help/${g.slug}`)} className="hc-pop">
                <span className="hc-pop-img">
                  {shot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/help/shots/${shot}.webp`} alt="" loading="lazy" />
                  ) : (
                    <span className="hc-pop-ico">{CAT_ICON[g.category]}</span>
                  )}
                  {videoFor(g.slug) && (
                    <span className="hc-pop-play">
                      <I.play size={16} />
                    </span>
                  )}
                </span>
                <b>{t(g.title)}</b>
                <span>{t(g.summary)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="hc-wrap hc-section">
        <h2 className="hc-h2">{t("All topics")}</h2>
        <div className="hc-cats">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="hc-cat" id={c.key}>
              <div className="hc-cat-head">
                <span className="hc-cat-ico">{CAT_ICON[c.key]}</span>
                <div>
                  <h3>{t(c.title)}</h3>
                  <p>{t(c.blurb)}</p>
                </div>
              </div>
              <ul>
                {GUIDES.filter((g) => g.category === c.key).map((g) => (
                  <li key={g.slug}>
                    <Link href={lp(`/help/${g.slug}`)}>
                      <span>{t(g.title)}</span>
                      {videoFor(g.slug) ? <I.play size={13} /> : <I.right size={13} />}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="hc-wrap hc-section">
        <div className="hc-contact">
          <div>
            <h2 className="hc-h2" style={{ margin: 0 }}>{t("Still stuck?")}</h2>
            <p>{t("Tell us what you were trying to do and we'll help.")}</p>
          </div>
          <Link className="btn btn-primary" href={lp("/contact")}>
            {t("Contact us")}
          </Link>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
