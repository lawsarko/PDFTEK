/**
 * Font-name helpers shared by the browser editor and the server.
 *
 * PDFs embed fonts under names like "BCDHEE+EB Garamond,BoldItalic", "ArialMT" or
 * "TimesNewRomanPS-BoldItalicMT". These helpers recover the family, weight and style, and map
 * proprietary families to freely downloadable fonts with matching metrics, so edited text can be
 * drawn in (practically) the same typeface as the original.
 */

export type FontFace = { family: string; bold: boolean; italic: boolean };

const STYLE_WORDS = /(Bold|Italic|Oblique|Regular|Light|Medium|Semibold|SemiBold|Demi|Black|Heavy|Roman|Book|Condensed)+$/i;

export function parseFontName(raw: string): FontFace {
  const name = (raw || "").replace(/^[A-Z]{6}\+/, "");
  const bold = /bold|black|heavy|semibold|demi/i.test(name);
  const italic = /italic|oblique/i.test(name);
  let base = name
    .split(/[-,]/)[0]
    .replace(/(PSMT|PS|MT)$/, "")
    .replace(STYLE_WORDS, "")
    .trim();
  if (!/\s/.test(base)) base = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return { family: canonical(base.trim()), bold, italic };
}

const CANONICAL: Record<string, string> = {
  Helvetica: "Arial",
  Arial: "Arial",
  Times: "Times New Roman",
  "Times New Roman": "Times New Roman",
  Courier: "Courier New",
  "Courier New": "Courier New",
  "Segoe UISymbol": "Segoe UI Symbol",
  "Segoe UI Symbol": "Segoe UI Symbol",
};

function canonical(family: string) {
  return CANONICAL[family] ?? CANONICAL[family.replace(/\s/g, "")] ?? family;
}

/**
 * Freely available fonts (Google Fonts) to download for a family. Proprietary families map to
 * metric-compatible open equivalents, so text keeps exactly the same width.
 */
const OPEN_EQUIVALENT: Record<string, string> = {
  Arial: "Arimo",
  "Times New Roman": "Tinos",
  "Courier New": "Cousine",
  Calibri: "Carlito",
  Cambria: "Caladea",
  Georgia: "Gelasio",
  Garamond: "EB Garamond",
  "Book Antiqua": "Gentium Book Plus",
  "Palatino Linotype": "Gentium Book Plus",
  Palatino: "Gentium Book Plus",
  "Century Gothic": "Questrial",
  "Segoe UI": "Open Sans",
  "Helvetica Neue": "Arimo",
};

export function downloadableFamily(family: string): string {
  return OPEN_EQUIVALENT[family] ?? family;
}

export function isSerif(family: string) {
  return /serif|times|tinos|georgia|gelasio|garamond|roman|cambria|caladea|book|antiqua|palatino|baskerville|caslon|minion|merriweather|lora|playfair|crimson|spectral|gentium/i.test(family) && !/sans/i.test(family);
}

/** CSS font stack for previews: the real family first, then a generic fallback of the same kind. */
export function cssStack(family: string | undefined, serif: boolean) {
  const generic = serif ? "Georgia, 'Times New Roman', serif" : "Arial, Helvetica, sans-serif";
  return family ? `"${family}", "${downloadableFamily(family)}", ${generic}` : generic;
}
