import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { PaywallHost } from "@/components/paywall";
import { AuthLinkCatcher } from "@/components/auth-link-catcher";
import { DomTranslator, I18nProvider } from "@/components/i18n";
import { coverage, getI18n, pick } from "@/lib/i18n/server";
import { IN_PROGRESS } from "@/lib/i18n/locales";
import SITE_STRINGS from "@/i18n/catalog-site.json";

const SITE = (process.env.APP_URL || "https://pdftek.com").replace(/\/$/, "");
const DESCRIPTION =
  "Free online PDF tools: convert PDF to Word, Excel, PowerPoint and JPG and back, merge, split, compress, protect, edit, e-sign and chat with PDFs. No sign-up needed.";

export async function generateMetadata(): Promise<Metadata> {
  const { t, info } = await getI18n();
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
    },
    twitter: { card: "summary_large_image", title: tagline, description },
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
    <html lang={info.tag} dir={info.rtl ? "rtl" : "ltr"}>
      <head>
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
