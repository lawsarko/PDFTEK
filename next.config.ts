import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist", "nodemailer"],
  experimental: {
    serverActions: { bodySizeLimit: "60mb" },
  },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      // Some browser libraries (pptxgenjs) reference Node built-ins behind runtime checks.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, https: false, http: false, path: false, os: false, stream: false, zlib: false, crypto: false, url: false };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
