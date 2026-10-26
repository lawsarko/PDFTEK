import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { PaywallHost } from "@/components/paywall";
import { AuthLinkCatcher } from "@/components/auth-link-catcher";
import { PurchaseTracker } from "@/components/purchase-tracker";
import { DomTranslator, I18nProvider } from "@/components/i18n";
import { coverage, getI18n, pick } from "@/lib/i18n/server";
import { IN_PROGRESS, LOCALES } from "@/lib/i18n/locales";
import SITE_STRINGS from "@/i18n/catalog-site.json";

// Google Analytics (GA4) and Google Ads share one Google tag. GA_MEASUREMENT_ID / GOOGLE_ADS_ID
// override the IDs; set either to "off" to disable it. GOOGLE_ADS_CONVERSION_LABEL overrides the
// Purchase conversion label ("off" stops reporting conversions).
const GA_ID = process.env.GA_MEASUREMENT_ID === "off" ? "" : process.env.GA_MEASUREMENT_ID || "G-V6BFFW3SN2";
const ADS_ID = process.env.GOOGLE_ADS_ID === "off" ? "" : process.env.GOOGLE_ADS_ID || "AW-18531956954";
// The "Purchase" conversion action in Google Ads.
const ADS_LABEL = process.env.GOOGLE_ADS_CONVERSION_LABEL ?? (process.env.GOOGLE_ADS_ID ? "" : "uInNCLe1yKcdENrx3IRF");
const ADS_CONVERSION = ADS_ID && ADS_LABEL && ADS_LABEL !== "off" ? `${ADS_ID}/${ADS_LABEL}` : "";
const TAG_IDS = [GA_ID, ADS_ID].filter(Boolean);

const SITE = (process.env.APP_URL || "https://pdftek.com").replace(/\/$/, "");
const DESCRIPTION =
  "Free online PDF tools: convert PDF to Word, Excel, PowerPoint and JPG and back, merge, split, compress, protect, edit, e-sign and chat with PDFs. No sign-up needed.";

export async function generateMetadata(): Promise<Metadata> {
  const { t, info, locale } = await getI18n();
  // A language that's still being translated would show mostly English under its own address:
  // keep it out of search results until it's done, so each language is indexed in its language.
  const ready = locale === "en" || coverage(locale) >= 0.9;
  const description = t(DESCRIPTION);
  const tagline = `PDFTEK – ${t("Every document, handled.")}`;
  return {
    metadataBase: new URL(SITE),
    title: {
      default: `PDFTEK – ${t("Free Online PDF Tools: Convert, Edit, Merge & Sign PDFs")}`,
      template: "%s | PDFTEK",
    },
    description,
    applicationName: "PDFTEK",
    openGraph: {
      type: "website",
      siteName: "PDFTEK",
      title: tagline,
      description,
      locale: info.tag.replace("-", "_"),
      alternateLocale: LOCALES.filter((l) => l.code !== locale).map((l) => l.tag.replace("-", "_")),
    },
    twitter: { card: "summary_large_image", title: tagline, description },
    robots: ready ? { index: true, follow: true } : { index: false, follow: true },
    // favicon.ico (src/app) is picked up automatically; Google's results use a square raster icon.
    icons: {
      icon: [
        { url: "/icon-48.png", sizes: "48x48", type: "image/png" },
        { url: "/icon-96.png", sizes: "96x96", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
      apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
    },
    // Paste the codes from Google Search Console and Bing Webmaster Tools into these env vars.
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
      other: process.env.BING_SITE_VERIFICATION
        ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
        : undefined,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#10151c",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, info } = await getI18n();
  const dict = pick(locale, SITE_STRINGS as string[]);
  const translating = locale !== "en" && coverage(locale) < 0.9 ? IN_PROGRESS[locale] : null;
  return (
    <html lang={info.tag} dir={info.rtl ? "rtl" : "ltr"} translate="no">
      <head>
        {/* pdftek translates itself. Browser translation (Chrome/Google Translate) rewrites the page
            behind React's back, which breaks menus and leaves sections blank. */}
        <meta name="google" content="notranslate" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {TAG_IDS.length > 0 && (
          <>
            {/* One Google tag for every ID (Google asks for no more than one tag per page). */}
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${TAG_IDS[0]}`} strategy="afterInteractive" />
            <Script id="google-tag" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
${TAG_IDS.map((id) => `gtag('config', '${id}');`).join("\n")}`}
            </Script>
            <PurchaseTracker adsConversion={ADS_CONVERSION} />
          </>
        )}
        <I18nProvider locale={locale} dict={dict}>
          {translating && (
            <div className="i18n-note" role="status" data-no-translate>
              {translating}
            </div>
          )}
          <ToastProvider>
            {children}
            <PaywallHost />
            <AuthLinkCatcher />
          </ToastProvider>
          <DomTranslator locale={locale} />
        </I18nProvider>
      </body>
    </html>
  );
}
