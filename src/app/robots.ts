import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo-tools";

// Public pages are open to search engines and AI assistants (so they can recommend PDFTEK).
// /go/* starts a guest session, and the app and API are private: keep crawlers out of them.
const PRIVATE = ["/go/", "/app/", "/api/", "/sign/", "/request/", "/invite/", "/auth/", "/reset", "/restore"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // Named explicitly so there's no doubt AI search and assistants may read the public pages.
      {
        userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended", "Bingbot"],
        allow: "/",
        disallow: PRIVATE,
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
