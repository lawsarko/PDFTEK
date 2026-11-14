import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/** Shared look for link previews (Google, X, LinkedIn, WhatsApp, iMessage…). */
export function ogImage(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #10151c 0%, #1a2230 60%, #2a2116 100%)", color: "#f1f3f6", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: 6 }}>
          <span>PDF</span>
          <span style={{ color: "#d98e2b" }}>TEK</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
          <div style={{ fontSize: 32, color: "#b6bfcc", lineHeight: 1.3 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#d98e2b" }}>Free online · No sign-up · No watermark</div>
      </div>
    ),
    OG_SIZE,
  );
}
