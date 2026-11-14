import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PDFTEK – Free Online PDF Tools",
    short_name: "PDFTEK",
    description: "Convert, merge, compress, edit, sign and chat with PDFs.",
    start_url: "/",
    display: "standalone",
    background_color: "#10151c",
    theme_color: "#10151c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
