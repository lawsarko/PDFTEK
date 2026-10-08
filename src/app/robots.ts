import type { MetadataRoute } from "next";

// /go/* starts a guest session, and the app and API are private: keep crawlers out of them.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/go/", "/app/", "/api/", "/sign/", "/request/", "/invite/"] } };
}
