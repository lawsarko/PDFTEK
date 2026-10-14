import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { PaywallHost } from "@/components/paywall";
import { AuthLinkCatcher } from "@/components/auth-link-catcher";

const SITE = (process.env.APP_URL || "https://pdftek.com").replace(/\/$/, "");
const DESCRIPTION =
  "Free online PDF tools: convert PDF to Word, Excel, PowerPoint and JPG and back, merge, split, compress, protect, edit, e-sign and chat with PDFs. No sign-up needed.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "PDFTEK – Free Online PDF Tools: Convert, Edit, Merge & Sign PDFs", template: "%s | PDFTEK" },
  description: DESCRIPTION,
  applicationName: "PDFTEK",
  openGraph: { type: "website", siteName: "PDFTEK", title: "PDFTEK – Every document, handled.", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "PDFTEK – Every document, handled.", description: DESCRIPTION },
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
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
};

export const viewport: Viewport = { themeColor: "#10151c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <ToastProvider>
          {children}
          <PaywallHost />
          <AuthLinkCatcher />
        </ToastProvider>
      </body>
    </html>
  );
}
