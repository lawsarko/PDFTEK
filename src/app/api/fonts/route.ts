import { route, badRequest, notFound } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { downloadableFamily } from "@/lib/font-names";
import { loadFont } from "@/lib/fonts";

/**
 * Serves TrueType fonts for the PDF editor so edited text uses the document's own typeface.
 * Fonts come from Google Fonts (proprietary families map to metric-compatible open fonts) and
 * are cached on disk. TrueType is requested because pdf-lib embeds TTF reliably.
 */
export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const requested = (url.searchParams.get("family") ?? "").trim();
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(requested)) throw badRequest("Invalid font family.");
  const family = downloadableFamily(requested);
  const bold = url.searchParams.get("bold") === "1";
  const italic = url.searchParams.get("italic") === "1";
  const data = await loadFont(family, { bold, italic });
  if (!data) throw notFound("Font not available.");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "font/ttf",
      "cache-control": "private, max-age=2592000, immutable",
      "x-font-family": family,
    },
  });
});
