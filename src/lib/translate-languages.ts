/**
 * Languages offered by Translate PDF, with the font used to draw each script. Shared by the
 * server (lib/pdf-translate.ts) and the language picker.
 */
export type TranslateLanguage = {
  code: string;
  english: string;
  native: string;
  /** Google Fonts family that covers the script (Noto). */
  font: string;
  /** A serif alternative for documents set in a serif face (Latin, Greek, Cyrillic only). */
  serif?: string;
  rtl?: boolean;
  /** Writes without spaces between words (lines may break between characters). */
  noSpaces?: boolean;
};

const LATIN = { font: "Noto Sans", serif: "Noto Serif" };

export const TRANSLATE_LANGUAGES: TranslateLanguage[] = [
  { code: "en", english: "English", native: "English", ...LATIN },
  { code: "es", english: "Spanish", native: "Español", ...LATIN },
  { code: "fr", english: "French", native: "Français", ...LATIN },
  { code: "de", english: "German", native: "Deutsch", ...LATIN },
  { code: "pt", english: "Portuguese", native: "Português", ...LATIN },
  { code: "it", english: "Italian", native: "Italiano", ...LATIN },
  { code: "nl", english: "Dutch", native: "Nederlands", ...LATIN },
  { code: "zh-cn", english: "Chinese (Simplified)", native: "中文 (简体)", font: "Noto Sans SC", noSpaces: true },
  { code: "zh-tw", english: "Chinese (Traditional)", native: "中文 (繁體)", font: "Noto Sans TC", noSpaces: true },
  { code: "ja", english: "Japanese", native: "日本語", font: "Noto Sans JP", noSpaces: true },
  { code: "ko", english: "Korean", native: "한국어", font: "Noto Sans KR" },
  { code: "ar", english: "Arabic", native: "العربية", font: "Noto Sans Arabic", rtl: true },
  { code: "he", english: "Hebrew", native: "עברית", font: "Noto Sans Hebrew", rtl: true },
  { code: "fa", english: "Persian", native: "فارسی", font: "Noto Sans Arabic", rtl: true },
  { code: "ru", english: "Russian", native: "Русский", ...LATIN },
  { code: "uk", english: "Ukrainian", native: "Українська", ...LATIN },
  { code: "pl", english: "Polish", native: "Polski", ...LATIN },
  { code: "tr", english: "Turkish", native: "Türkçe", ...LATIN },
  { code: "vi", english: "Vietnamese", native: "Tiếng Việt", ...LATIN },
  { code: "id", english: "Indonesian", native: "Bahasa Indonesia", ...LATIN },
  { code: "ms", english: "Malay", native: "Bahasa Melayu", ...LATIN },
  { code: "tl", english: "Filipino", native: "Filipino", ...LATIN },
  { code: "el", english: "Greek", native: "Ελληνικά", ...LATIN },
  { code: "sv", english: "Swedish", native: "Svenska", ...LATIN },
  { code: "da", english: "Danish", native: "Dansk", ...LATIN },
  { code: "no", english: "Norwegian", native: "Norsk", ...LATIN },
  { code: "fi", english: "Finnish", native: "Suomi", ...LATIN },
  { code: "cs", english: "Czech", native: "Čeština", ...LATIN },
  { code: "ro", english: "Romanian", native: "Română", ...LATIN },
  { code: "hu", english: "Hungarian", native: "Magyar", ...LATIN },
  { code: "bg", english: "Bulgarian", native: "Български", ...LATIN },
  { code: "ca", english: "Catalan", native: "Català", ...LATIN },
  { code: "sw", english: "Swahili", native: "Kiswahili", ...LATIN },
  { code: "yo", english: "Yoruba", native: "Yorùbá", ...LATIN },
  { code: "ha", english: "Hausa", native: "Hausa", ...LATIN },
  { code: "ig", english: "Igbo", native: "Igbo", ...LATIN },
  { code: "af", english: "Afrikaans", native: "Afrikaans", ...LATIN },
  // Hindi, Bengali, Thai and Amharic need mark positioning that pdf-lib doesn't do yet (marks
  // and vowel signs render with gaps), so they're left out until text is shaped with HarfBuzz.
];

export const translateLanguage = (code: string) => TRANSLATE_LANGUAGES.find((l) => l.code === code);
