/**
 * Languages pdftek is offered in. English is the default and lives at the site root; every other
 * language has its own address prefix (/es/pricing, /ja/merge-pdf) so search engines index each one.
 */
export type Locale = {
  code: string;
  /** The language's own name, shown in the switcher. */
  name: string;
  english: string;
  /** hreflang / <html lang> value. */
  tag: string;
  rtl?: boolean;
};

export const LOCALES: Locale[] = [
  { code: "en", name: "English", english: "English", tag: "en" },
  { code: "es", name: "Español", english: "Spanish", tag: "es" },
  { code: "fr", name: "Français", english: "French", tag: "fr" },
  { code: "de", name: "Deutsch", english: "German", tag: "de" },
  { code: "it", name: "Italiano", english: "Italian", tag: "it" },
  { code: "pt", name: "Português", english: "Portuguese", tag: "pt" },
  { code: "ja", name: "日本語", english: "Japanese", tag: "ja" },
  { code: "ru", name: "Русский", english: "Russian", tag: "ru" },
  { code: "ko", name: "한국어", english: "Korean", tag: "ko" },
  { code: "zh-cn", name: "中文 (简体)", english: "Chinese (Simplified)", tag: "zh-Hans" },
  { code: "zh-tw", name: "中文 (繁體)", english: "Chinese (Traditional)", tag: "zh-Hant" },
  { code: "ar", name: "العربية", english: "Arabic", tag: "ar", rtl: true },
  { code: "bg", name: "Български", english: "Bulgarian", tag: "bg" },
  { code: "ca", name: "Català", english: "Catalan", tag: "ca" },
  { code: "nl", name: "Nederlands", english: "Dutch", tag: "nl" },
  { code: "el", name: "Ελληνικά", english: "Greek", tag: "el" },
  { code: "hi", name: "हिन्दी", english: "Hindi", tag: "hi" },
  { code: "id", name: "Bahasa Indonesia", english: "Indonesian", tag: "id" },
  { code: "ms", name: "Bahasa Melayu", english: "Malay", tag: "ms" },
  { code: "pl", name: "Polski", english: "Polish", tag: "pl" },
  { code: "sv", name: "Svenska", english: "Swedish", tag: "sv" },
  { code: "th", name: "ภาษาไทย", english: "Thai", tag: "th" },
  { code: "tr", name: "Türkçe", english: "Turkish", tag: "tr" },
  { code: "uk", name: "Українська", english: "Ukrainian", tag: "uk" },
  { code: "vi", name: "Tiếng Việt", english: "Vietnamese", tag: "vi" },
  { code: "sw", name: "Kiswahili", english: "Swahili", tag: "sw" },
];

export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "pdftek-lang";
export const LOCALE_HEADER = "x-pdftek-locale";
const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export const isLocale = (code: string | null | undefined): code is string => !!code && BY_CODE.has(code);
export const localeInfo = (code: string) => BY_CODE.get(code) ?? LOCALES[0];

/** "/pricing" in Spanish is "/es/pricing"; English stays at the root. */
export function localizePath(path: string, locale: string): string {
  const clean = stripLocale(path);
  if (locale === DEFAULT_LOCALE || !isLocale(locale)) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/** Removes a language prefix: "/es/pricing" → "/pricing". */
export function stripLocale(path: string): string {
  const seg = path.split("/")[1]?.toLowerCase();
  if (seg && seg !== DEFAULT_LOCALE && isLocale(seg)) return path.slice(seg.length + 1) || "/";
  return path || "/";
}

/**
 * Pages that exist in every language (the public website). The app, API, signing links and
 * redirects are single-address and follow the language cookie instead.
 */
export function isSitePath(path: string): boolean {
  if (path === "/") return true;
  return !/^\/(app|api|_next|sign|request|invite|go|auth|restore)(\/|$)/.test(path) && !/\.[a-z0-9]+$/i.test(path);
}
