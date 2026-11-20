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

/** Shown while a language is still being translated (the rest of the page falls back to English). */
export const IN_PROGRESS: Record<string, string> = {
  es: "Estamos traduciendo pdftek al español. Algunos textos pueden aparecer en inglés durante unos minutos.",
  fr: "La traduction de pdftek en français est en cours. Certains textes peuvent rester en anglais pendant quelques minutes.",
  de: "pdftek wird gerade ins Deutsche übersetzt. Einige Texte können noch einige Minuten auf Englisch erscheinen.",
  it: "Stiamo traducendo pdftek in italiano. Alcuni testi potrebbero apparire in inglese per qualche minuto.",
  pt: "Estamos traduzindo o pdftek para o português. Alguns textos podem aparecer em inglês por alguns minutos.",
  ja: "pdftek を日本語に翻訳しています。数分間、一部のテキストが英語で表示される場合があります。",
  ru: "Мы переводим pdftek на русский язык. В течение нескольких минут часть текста может отображаться на английском.",
  ko: "pdftek을 한국어로 번역하고 있습니다. 몇 분 동안 일부 텍스트가 영어로 표시될 수 있습니다.",
  "zh-cn": "我们正在将 pdftek 翻译成简体中文。几分钟内，部分文字可能仍以英文显示。",
  "zh-tw": "我們正在將 pdftek 翻譯成繁體中文。幾分鐘內，部分文字可能仍以英文顯示。",
  ar: "نعمل على ترجمة pdftek إلى العربية. قد يظهر بعض النص باللغة الإنجليزية لبضع دقائق.",
  bg: "Превеждаме pdftek на български. Част от текста може да се показва на английски още няколко минути.",
  ca: "Estem traduint pdftek al català. Alguns textos poden aparèixer en anglès durant uns minuts.",
  nl: "We vertalen pdftek naar het Nederlands. Sommige tekst kan nog een paar minuten in het Engels verschijnen.",
  el: "Μεταφράζουμε το pdftek στα ελληνικά. Ορισμένο κείμενο μπορεί να εμφανίζεται στα αγγλικά για λίγα λεπτά.",
  hi: "हम pdftek का हिन्दी में अनुवाद कर रहे हैं। कुछ मिनटों तक कुछ टेक्स्ट अंग्रेज़ी में दिख सकता है।",
  id: "Kami sedang menerjemahkan pdftek ke Bahasa Indonesia. Beberapa teks mungkin masih tampil dalam bahasa Inggris selama beberapa menit.",
  ms: "Kami sedang menterjemah pdftek ke Bahasa Melayu. Sesetengah teks mungkin dipaparkan dalam bahasa Inggeris selama beberapa minit.",
  pl: "Tłumaczymy pdftek na język polski. Przez kilka minut część tekstu może być wyświetlana po angielsku.",
  sv: "Vi översätter pdftek till svenska. En del text kan visas på engelska i några minuter.",
  th: "เรากำลังแปล pdftek เป็นภาษาไทย ข้อความบางส่วนอาจแสดงเป็นภาษาอังกฤษสักครู่",
  tr: "pdftek'i Türkçeye çeviriyoruz. Bazı metinler birkaç dakika boyunca İngilizce görünebilir.",
  uk: "Ми перекладаємо pdftek українською. Протягом кількох хвилин частина тексту може відображатися англійською.",
  vi: "Chúng tôi đang dịch pdftek sang tiếng Việt. Một số nội dung có thể hiển thị bằng tiếng Anh trong vài phút.",
  sw: "Tunatafsiri pdftek kwa Kiswahili. Baadhi ya maandishi yanaweza kuonekana kwa Kiingereza kwa dakika chache.",
};
