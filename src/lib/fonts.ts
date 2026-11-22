import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./db";

/**
 * TrueType fonts for drawing text into PDFs (the editor and Translate PDF). Fonts come from
 * Google Fonts and are cached on disk; TrueType is requested because pdf-lib embeds TTF reliably.
 * If Google Fonts can't be reached, the Noto fonts installed in the Docker image are used.
 */

const CACHE = path.join(DATA_DIR, "fonts");
const MISSING = new Map<string, number>(); // families Google doesn't have (remembered for 1h)

const LOCAL_DIRS = ["/usr/share/fonts/truetype/noto", "/usr/share/fonts/truetype/dejavu"];
/** Installed equivalents (Debian fonts-noto-core / fonts-dejavu) when downloading fails. */
const LOCAL: Record<string, [string, string]> = {
  "Noto Sans": ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"],
  "Noto Serif": ["NotoSerif-Regular.ttf", "NotoSerif-Bold.ttf"],
  "Noto Sans Arabic": ["NotoSansArabic-Regular.ttf", "NotoSansArabic-Bold.ttf"],
  "Noto Sans Hebrew": ["NotoSansHebrew-Regular.ttf", "NotoSansHebrew-Bold.ttf"],
  "Noto Sans Devanagari": ["NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari-Bold.ttf"],
  "Noto Sans Bengali": ["NotoSansBengali-Regular.ttf", "NotoSansBengali-Bold.ttf"],
  "Noto Sans Thai": ["NotoSansThai-Regular.ttf", "NotoSansThai-Bold.ttf"],
  "Noto Sans Tamil": ["NotoSansTamil-Regular.ttf", "NotoSansTamil-Bold.ttf"],
  "Noto Sans Ethiopic": ["NotoSansEthiopic-Regular.ttf", "NotoSansEthiopic-Bold.ttf"],
  "DejaVu Sans": ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"],
};

export async function loadFont(family: string, opts: { bold?: boolean; italic?: boolean } = {}): Promise<Buffer | null> {
  const bold = Boolean(opts.bold);
  const italic = Boolean(opts.italic);
  const key = `${family.replace(/\s+/g, "_")}-${bold ? 700 : 400}${italic ? "i" : ""}`;
  const file = path.join(CACHE, `${key}.ttf`);
  let data: Buffer | null = await fs.readFile(file).catch(() => null);
  if (data) return data;
  if ((MISSING.get(key) ?? 0) <= Date.now()) {
    data = await download(family, bold, italic);
    if (data) {
      await fs.mkdir(CACHE, { recursive: true });
      await fs.writeFile(file, data).catch(() => {});
      return data;
    }
    MISSING.set(key, Date.now() + 3600_000);
  }
  const local = LOCAL[family];
  if (local) {
    for (const dir of LOCAL_DIRS) {
      const hit = await fs.readFile(path.join(dir, local[bold ? 1 : 0])).catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}

async function download(family: string, bold: boolean, italic: boolean): Promise<Buffer | null> {
  // Try the exact weight/style first, then fall back to the closest the family offers.
  const variants: [number, number][] = [
    [italic ? 1 : 0, bold ? 700 : 400],
    [0, bold ? 700 : 400],
    [italic ? 1 : 0, 400],
    [0, 400],
  ];
  for (const [ital, wght] of variants) {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@${ital},${wght}`, {
      // An old user agent makes Google Fonts serve TrueType rather than WOFF2.
      headers: { "user-agent": "Mozilla/4.0 (compatible; pdftek)" },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!css?.ok) continue;
    const ttf = (await css.text()).match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)?.[1];
    if (!ttf) continue;
    const res = await fetch(ttf, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}
