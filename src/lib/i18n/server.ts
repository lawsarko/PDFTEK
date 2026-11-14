import "server-only";
import { cookies, headers } from "next/headers";
import { all, get, run } from "../db";
import { now } from "../ids";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, localeInfo, localizePath, LOCALES } from "./locales";
import { compile, fill, isPattern, norm, type Dict } from "./match";

/**
 * Server-side translation. Pages call `const { t } = await getI18n()` and wrap their English text in
 * t(); text without a translation yet is shown in English and queued for the translator, so new
 * copy is picked up without any extra step.
 */

type Cache = { version: string; checked: number; dict: Dict; lookup: (s: string) => string | null };
const caches = new Map<string, Cache>();
// The translator runs in its own copy of this module (instrumentation), so changes are noticed by
// looking at the table itself, at most every few seconds.
let version = 1;
const RECHECK_MS = 5000;
const known = new Set<string>();
let knownLoaded = false;

/** Called by the translator after it saves translations. */
export function bumpI18n() {
  version++;
}

function loadKnown() {
  if (knownLoaded) return;
  for (const r of all<{ text: string }>("SELECT text FROM i18n_source")) known.add(r.text);
  knownLoaded = true;
}

/** Adds English strings to translate (from pages, the build catalog or data files). */
export function registerSources(texts: string[], origin = "page") {
  loadKnown();
  for (const raw of texts) {
    const text = norm(raw);
    if (!text || text.length > 4000 || known.has(text) || !/\p{L}/u.test(text)) continue;
    known.add(text);
    run("INSERT OR IGNORE INTO i18n_source (text, origin, created_at) VALUES (?, ?, ?)", text, origin, now());
  }
}

function stamp(locale: string) {
  const r = get<{ n: number; last: number | null }>("SELECT count(*) AS n, max(created_at) AS last FROM i18n_text WHERE locale = ?", locale);
  return `${r?.n ?? 0}-${r?.last ?? 0}-${version}`;
}

export function dictFor(locale: string): Cache {
  const hit = caches.get(locale);
  if (hit && Date.now() - hit.checked < RECHECK_MS) return hit;
  const v = stamp(locale);
  if (hit && hit.version === v) {
    hit.checked = Date.now();
    return hit;
  }
  const exact: Record<string, string> = {};
  const patterns: [string, string][] = [];
  for (const r of all<{ source: string; text: string }>("SELECT source, text FROM i18n_text WHERE locale = ?", locale)) {
    if (isPattern(r.source)) patterns.push([r.source, r.text]);
    else exact[r.source] = r.text;
  }
  const dict = { exact, patterns };
  const c = { version: v, checked: Date.now(), dict, lookup: compile(dict) };
  caches.set(locale, c);
  return c;
}

export const i18nVersion = (locale: string) => dictFor(locale).version;

/** The visitor's language: from the address prefix (set by middleware), else their saved choice. */
export async function getLocale(): Promise<string> {
  const h = (await headers()).get(LOCALE_HEADER);
  if (isLocale(h)) return h;
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(c) ? c : DEFAULT_LOCALE;
}

export type T = (english: string, vars?: Record<string, string | number>) => string;

const demandAt = new Map<string, number>();
/** Notes that someone is reading the site in this language, so the translator does it first. */
export function noteDemand(locale: string) {
  if (locale === DEFAULT_LOCALE || Date.now() - (demandAt.get(locale) ?? 0) < 30_000) return;
  demandAt.set(locale, Date.now());
  run("INSERT INTO i18n_demand (locale, at) VALUES (?, ?) ON CONFLICT(locale) DO UPDATE SET at = excluded.at", locale, now());
}

export function translator(locale: string): T {
  if (locale === DEFAULT_LOCALE) return (s, vars) => fill(s, vars);
  const { lookup } = dictFor(locale);
  return (s, vars) => {
    const hit = lookup(s);
    if (hit === null) {
      registerSources([s]);
      noteDemand(locale);
    }
    return fill(hit ?? s, vars);
  };
}

/** Share of the interface translated into a language (0–1). */
export function coverage(locale: string): number {
  if (locale === DEFAULT_LOCALE) return 1;
  const total = get<{ n: number }>("SELECT count(*) AS n FROM i18n_source")?.n ?? 0;
  if (!total) return 0;
  return Object.keys(dictFor(locale).dict.exact).length / total + dictFor(locale).dict.patterns.length / total;
}

export async function getI18n() {
  const locale = await getLocale();
  const info = localeInfo(locale);
  return {
    locale,
    info,
    t: translator(locale),
    /** Link to a page in the current language. */
    lp: (path: string) => localizePath(path, locale),
  };
}

let readyCache: { at: number; codes: Set<string> } | null = null;
/**
 * Languages whose translation is (nearly) complete. Only these are offered to search engines
 * (hreflang, sitemap); the rest are noindex until the translator finishes them.
 */
export function readyLocales(): Set<string> {
  if (readyCache && Date.now() - readyCache.at < 60_000) return readyCache.codes;
  const total = get<{ n: number }>("SELECT count(*) AS n FROM i18n_source")?.n ?? 0;
  const codes = new Set<string>([DEFAULT_LOCALE]);
  if (total) for (const r of all<{ locale: string; n: number }>("SELECT locale, count(*) AS n FROM i18n_text GROUP BY locale")) if (r.n / total >= 0.9) codes.add(r.locale);
  readyCache = { at: Date.now(), codes };
  return codes;
}

/** hreflang links for a public page (languages that are ready), plus its canonical address. */
export function alternatesFor(path: string, locale: string) {
  const ready = readyLocales();
  const languages: Record<string, string> = { "x-default": path };
  for (const l of LOCALES) if (ready.has(l.code)) languages[l.tag] = localizePath(path, l.code);
  return { canonical: localizePath(path, locale), languages };
}

/** Translations of a list of strings, for client components rendered on the server. */
export function pick(locale: string, texts: string[]): Record<string, string> {
  if (locale === DEFAULT_LOCALE) return {};
  const { lookup } = dictFor(locale);
  const out: Record<string, string> = {};
  for (const s of texts) {
    const hit = lookup(s);
    if (hit !== null) out[norm(s)] = hit;
    else {
      registerSources([s]);
      noteDemand(locale);
    }
  }
  return out;
}
