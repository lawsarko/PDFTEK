import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/seo-meta";
import { currentUser } from "@/lib/auth";
import { MarketingFooter, MarketingNav } from "@/components/marketing";
import { I } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { siteUrl } from "@/lib/seo-tools";
import { getI18n } from "@/lib/i18n/server";
import { CATEGORIES, GUIDES, guideBySlug } from "@/lib/help/guides";
import { hasShot, videoFor } from "@/lib/help/media";
import { GuideVideo } from "@/components/help/video-player";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P) {
  const g = guideBySlug((await params).slug);
  if (!g) return {};
  return pageMeta(`/help/${g.slug}`, { title: g.title, description: g.summary });
}

const PLAN_TONE: Record<string, string> = { Free: "badge-good", Pro: "badge-warn", "Pro or Day Pass": "badge-warn", "AI credits": "badge-info" };

export default async function GuidePage({ params }: P) {
  const g = guideBySlug((await params).slug);
  if (!g) notFound();
  const user = await currentUser();
  const { t, lp } = await getI18n();
  const cat = CATEGORIES.find((c) => c.key === g.category)!;
  const video = videoFor(g.slug);
  const siblings = GUIDES.filter((x) => x.category === g.category);
  const i = siblings.findIndex((x) => x.slug === g.slug);
  const next = siblings[i + 1] ?? GUIDES[GUIDES.findIndex((x) => x.slug === g.slug) + 1];
  const related = (g.related ?? []).map((s) => guideBySlug(s)).filter((x): x is NonNullable<typeof x> => !!x);
  const url = `${siteUrl()}${lp(`/help/${g.slug}`)}`;
  const firstShot = g.steps.find((s) => hasShot(s.shot))?.shot;

  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: t(g.title),
          description: t(g.summary),
          url,
          ...(firstShot ? { image: `${siteUrl()}/help/shots/${firstShot}.webp` } : {}),
          step: g.steps.map((s, n) => ({
            "@type": "HowToStep",
            position: n + 1,
            name: t(s.title),
            text: t(s.text),
            ...(hasShot(s.shot) ? { image: `${siteUrl()}/help/shots/${s.shot}.webp` } : {}),
          })),
          ...(video
            ? {
                video: {
                  "@type": "VideoObject",
                  name: t(g.title),
                  description: t(g.summary),
                  contentUrl: `${siteUrl()}/help/video/${g.slug}.mp4`,
                  thumbnailUrl: `${siteUrl()}/help/video/${g.slug}.jpg`,
                  uploadDate: "2026-11-27",
                  duration: `PT${Math.round(video.duration)}S`,
                },
              }
            : {}),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: t("Help Center"), item: `${siteUrl()}${lp("/help")}` },
            { "@type": "ListItem", position: 2, name: t(cat.title), item: `${siteUrl()}${lp("/help")}#${cat.key}` },
            { "@type": "ListItem", position: 3, name: t(g.title), item: url },
          ],
        }}
      />
      <MarketingNav signedIn={!!user && !user.is_guest} />

      <article className="hc-wrap hc-guide">
        <nav className="hc-crumbs" aria-label={t("Breadcrumb")}>
          <Link href={lp("/help")}>{t("Help Center")}</Link>
          <I.right size={12} />
          <Link href={`${lp("/help")}#${cat.key}`}>{t(cat.title)}</Link>
        </nav>
        <h1>{t(g.title)}</h1>
        <p className="hc-lead">{t(g.summary)}</p>
        <div className="hc-meta">
          {g.plan && <span className={`badge ${PLAN_TONE[g.plan] ?? "badge-muted"}`}>{t(g.plan)}</span>}
          <span>
            {g.steps.length} {t("steps")}
          </span>
          {video && (
            <span>
              <I.play size={12} /> {t("{n} min video", { n: Math.max(1, Math.round(video.duration / 60)) })}
            </span>
          )}
        </div>

        {video && (
          <GuideVideo
            src={`/help/video/${g.slug}.mp4`}
            poster={`/help/video/${g.slug}.jpg`}
            duration={video.duration}
            cues={video.cues.map((c) => ({ ...c, text: t(c.text) }))}
            title={t(g.title)}
            stepTitles={g.steps.map((s) => t(s.title))}
            labels={{
              play: t("Play"),
              pause: t("Pause"),
              voiceOn: t("Voice on"),
              voiceOff: t("Voice off"),
              captionsOn: t("Captions on"),
              captionsOff: t("Captions off"),
              fullscreen: t("Full screen"),
              step: t("Step"),
              replay: t("Watch again"),
            }}
          />
        )}

        <ol className="hc-steps">
          {g.steps.map((s, n) => (
            <li key={n} className="hc-step" id={`step-${n + 1}`}>
              <span className="hc-step-n">{n + 1}</span>
              <div className="hc-step-body">
                <h2>{t(s.title)}</h2>
                <p>{t(s.text)}</p>
                {hasShot(s.shot) && (
                  <figure className="hc-shot">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/help/shots/${s.shot}.webp`} alt={t(s.title)} loading={n === 0 && !video ? "eager" : "lazy"} />
                  </figure>
                )}
              </div>
            </li>
          ))}
        </ol>

        {g.tip && (
          <div className="hc-tip">
            <I.info size={18} />
            <p>{t(g.tip)}</p>
          </div>
        )}

        <div className="hc-try">
          <div>
            <b>{t("Ready to try it?")}</b>
            <span>{t("Open your workbench and follow along.")}</span>
          </div>
          <Link prefetch={false} className="btn btn-primary" href={g.try?.href ?? (user ? "/app" : "/go/start")}>
            {g.try ? t(g.try.label) : user ? t("Open workbench") : t("Start free")}
          </Link>
        </div>

        {related.length > 0 && (
          <section className="hc-related">
            <h2 className="hc-h2">{t("Related guides")}</h2>
            <div className="hc-related-list">
              {related.map((r) => (
                <Link key={r.slug} href={lp(`/help/${r.slug}`)} className="hc-rel">
                  <b>{t(r.title)}</b>
                  <span>{t(r.summary)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {next && (
          <Link className="hc-next" href={lp(`/help/${next.slug}`)}>
            <span>{t("Next guide")}</span>
            <b>
              {t(next.title)} <I.right size={14} />
            </b>
          </Link>
        )}
      </article>
      <MarketingFooter />
    </div>
  );
}
