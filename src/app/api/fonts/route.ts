import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/db";
import { route, badRequest, notFound } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { downloadableFamily } from "@/lib/font-names";

/**
 * Serves TrueType fonts for the PDF editor so edited text uses the document's own typeface.
 * Fonts come from Google Fonts (proprietary families map to metric-compatible open fonts) and
 * are cached on disk. TrueType is requested because pdf-lib embeds TTF reliably.
 */
const CACHE = path.join(DATA_DIR, "fonts");
const MISSING = new Map<string, number>(); // remembers families Google doesn't have (1h)

export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const requested = (url.searchParams.get("family") ?? "").trim();
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(requested)) throw badRequest("Invalid font family.");
  const family = downloadableFamily(requested);
  const bold = url.searchParams.get("bold") === "1";
  const italic = url.searchParams.get("italic") === "1";
  const key = `${family.replace(/\s+/g, "_")}-${bold ? 700 : 400}${italic ? "i" : ""}`;
  const file = path.join(CACHE, `${key}.ttf`);

  let data: Buffer | null = await fs.readFile(file).catch(() => null);
  if (!data) {
    if ((MISSING.get(key) ?? 0) > Date.now()) throw notFound("Font not available.");
    data = await download(family, bold, italic);
    if (!data) {
      MISSING.set(key, Date.now() + 3600_000);
      throw notFound("Font not available.");
    }
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, data);
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "font/ttf",
      "cache-control": "private, max-age=2592000, immutable",
      "x-font-family": family,
    },
  });
});

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
    const res = await fetch(ttf, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}
