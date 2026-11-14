import Link from "next/link";
import { Logo, Wordmark } from "./icons";
import { MarketingMenu } from "./marketing-menu";
import { LanguageSwitcher } from "./i18n";
import { SEO_TOOLS } from "@/lib/seo-tools";
import { getI18n } from "@/lib/i18n/server";

export async function MarketingNav({ signedIn }: { signedIn: boolean }) {
  const { t, lp } = await getI18n();
  return (
    <nav className="mk-nav">
      <div className="mk-nav-inner">
        <Link href={lp("/")} className="brand">
          <Logo /> <Wordmark />
        </Link>
        <MarketingMenu />
        <span className="grow" />
        <Link href={lp("/pricing")} className="mk-link hide-mobile">
          {t("Pricing")}
        </Link>
        {signedIn ? (
          <Link className="btn btn-primary btn-sm" href="/app">
            {t("Open workbench")}
          </Link>
        ) : (
          <>
            <Link className="btn btn-ghost btn-sm" href={lp("/login")}>
              {t("Sign in")}
            </Link>
            <Link prefetch={false} className="btn btn-primary btn-sm" href="/go/start">
              {t("Start free")}
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

export async function MarketingFooter() {
  const { t, lp } = await getI18n();
  return (
    <footer className="mk-footer">
      <nav className="mk-footer-tools" aria-label={t("PDF tools")}>
        {SEO_TOOLS.map((tool) => (
          <Link key={tool.slug} href={lp(`/${tool.slug}`)}>
            {t(tool.name)}
          </Link>
        ))}
      </nav>
      <div className="mk-footer-inner">
        <div className="col gap-8">
          <span className="brand">
            <Logo /> <Wordmark />
          </span>
          <span>{t("The document workbench for professional teams.")}</span>
        </div>
        <div className="row gap-24 wrap">
          <Link href={lp("/tools")}>{t("All PDF tools")}</Link>
          <Link href={lp("/pricing")}>{t("Pricing")}</Link>
          <Link href={`${lp("/")}#convert`}>{t("Convert")}</Link>
          <Link href={`${lp("/")}#features`}>{t("Features")}</Link>
          <Link href={lp("/how-it-works")}>{t("How it works")}</Link>
          <Link href={`${lp("/")}#security`}>{t("Security")}</Link>
          <Link href={`${lp("/")}#faq`}>{t("FAQ")}</Link>
          <Link href={lp("/terms")}>{t("Terms")}</Link>
          <Link href={lp("/privacy")}>{t("Privacy")}</Link>
          <Link href={lp("/contact")}>{t("Contact us")}</Link>
        </div>
        <div className="row gap-16 wrap" style={{ alignItems: "center" }}>
          <LanguageSwitcher variant="footer" />
          <span>© {new Date().getFullYear()} PDFTEK</span>
        </div>
      </div>
      <p className="mk-footer-made">
        {t("Made in Chicago, USA with love")} <span className="heart" aria-hidden="true">♥</span>
      </p>
    </footer>
  );
}
