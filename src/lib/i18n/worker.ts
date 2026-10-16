import "server-only";
import { all, run, tx } from "../db";
import { now } from "../ids";
import { aiConfigured, structured } from "../ai";
import { HttpError } from "../http";
import { LOCALES, DEFAULT_LOCALE } from "./locales";
import { bumpI18n, registerSources } from "./server";
import catalog from "../../i18n/catalog.json";

/**
 * Background translator. On start it registers every English string the build found (plus the
 * tool pages' and plans' copy), then keeps translating whatever is missing into each language with
 * Claude, a batch at a time. Results live in the database, so each string is translated once;
 * after a deploy only new or changed text is sent. Set PDFTEK_TRANSLATE=0 to switch it off.
 */

const BATCH_CHARS = 9000;
const BATCH_MAX = 90;
const PARALLEL = Number(process.env.PDFTEK_TRANSLATE_PARALLEL) || 3;
const TICK_MS = Number(process.env.PDFTEK_TRANSLATE_TICK_MS) || 15_000;
/** Optional comma-separated list to translate only some languages (e.g. "es,fr"). */
const ONLY = (process.env.PDFTEK_TRANSLATE_LOCALES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

let started = false;
let pausedUntil = 0;
let busy = 0;

async function registerAll() {
  registerSources(catalog as string[], "catalog");
  // Copy assembled at runtime (template strings with prices and limits) isn't in the catalog verbatim.
  const { SEO_TOOLS, ACCESS_NOTE } = await import("../seo-tools");
  const { PRODUCTS, PRICING_FAQ } = await import("../plans");
  const texts: string[] = [...Object.values(ACCESS_NOTE)];
  for (const t of SEO_TOOLS) {
    texts.push(t.name, t.category, t.title, t.description, t.h1, t.lead, ...t.benefits);
    for (const [a, b] of t.steps) texts.push(a, b);
    for (const [q, a] of t.faq) texts.push(q, a);
  }
  for (const p of Object.values(PRODUCTS)) texts.push(p.name, p.description);
  for (const [q, a] of PRICING_FAQ) texts.push(q, a);
  registerSources(texts, "data");
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "integer" }, text: { type: "string" } } },
    },
  },
};

function system(language: string, native: string) {
  return `You are the professional localizer for PDFTEK (pdftek.com), an online PDF tool site: convert, edit, merge, sign, fill forms, and AI features. Translate interface strings from English into ${language} (${native}).

Rules:
- Write what a native ${language} product team would ship: natural, clear and concise, in the register modern consumer software uses in ${language}. Keep terminology consistent across strings.
- Never translate: the brand names PDFTEK and pdftek, product and format names (PDF, Word, Excel, PowerPoint, JPG, PNG, WEBP, TIFF, XLSX, CSV, OCR, Stripe, Google, QuickBooks, Xero, Slack, Teams, Claude), URLs, email addresses, file names, prices, and code.
- Placeholders like {0}, {1}, {n} or {name} must appear in your translation exactly as written; move them where the grammar needs them.
- "(s)" marks an optional English plural ending: write the natural form for ${language} without "(s)".
- Some strings are fragments of a longer sentence, split around a number, name or link (they may start or end mid-sentence). Translate them so they still read naturally next to that value. Keep any leading or trailing punctuation such as ":" or "·".
- Keep symbols, emoji, arrows, bullets and line breaks. Use the punctuation conventions of ${language}.
- Legal and pricing text must stay accurate: translate meaning faithfully, never add or drop conditions.
- Return every id exactly once.`;
}

async function translateBatch(locale: string, rows: { text: string }[]) {
  const info = LOCALES.find((l) => l.code === locale)!;
  const items = rows.map((r, i) => ({ id: i, text: r.text }));
  const out = await structured<{ items: { id: number; text: string }[] }>({
    system: system(info.english, info.name),
    content: [{ type: "text", text: `Translate these ${items.length} strings into ${info.english}. Input JSON:\n${JSON.stringify(items)}` }],
    schema: SCHEMA,
    effort: "low",
    maxTokens: 32000,
    tooLong: "Translation batch too long",
  });
  const byId = new Map(out.items.map((i) => [i.id, i.text]));
  tx(() => {
    for (const it of items) {
      let text = byId.get(it.id)?.trim();
      if (!text) continue;
      // A translation that lost a placeholder would show "{0}" or drop a number; keep English instead.
      const need = it.text.match(/\{\w+\}/g) ?? [];
      if (need.some((p) => !text!.includes(p))) continue;
      text = text.replace(/\(s\)/g, "");
      run("INSERT OR REPLACE INTO i18n_text (locale, source, text, created_at) VALUES (?, ?, ?, ?)", locale, it.text, text, now());
    }
  });
  bumpI18n();
}

/** Missing strings for a language (page copy and short UI text first), skipping ones in flight. */
function missing(locale: string, skip: Set<string>) {
  const cap = batchCap.get(locale) ?? BATCH_MAX;
  const rows = all<{ text: string }>(
    `SELECT s.text FROM i18n_source s
      WHERE NOT EXISTS (SELECT 1 FROM i18n_text x WHERE x.locale = ? AND x.source = s.text)
      ORDER BY CASE s.origin WHEN 'page' THEN 0 WHEN 'data' THEN 1 ELSE 2 END, length(s.text)
      LIMIT 600`,
    locale,
  );
  const batch: { text: string }[] = [];
  let chars = 0;
  for (const r of rows) {
    if (skip.has(r.text)) continue;
    if (batch.length && (chars + r.text.length > BATCH_CHARS * (cap / BATCH_MAX) || batch.length >= cap)) break;
    batch.push(r);
    chars += r.text.length;
  }
  return batch;
}

function setState(key: string, value: string) {
  run("INSERT INTO i18n_state (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at", key, value, now());
}

const inFlight = new Map<string, Set<string>>(); // locale -> source texts being translated
const batchCap = new Map<string, number>(); // smaller batches after a batch failed
const batchesFor = new Map<string, number>();
let rotate = 0;

function start(locale: string, batch: { text: string }[]) {
  const texts = inFlight.get(locale) ?? new Set<string>();
  inFlight.set(locale, texts);
  batch.forEach((b) => texts.add(b.text));
  batchesFor.set(locale, (batchesFor.get(locale) ?? 0) + 1);
  busy++;
  translateBatch(locale, batch)
    .then(() => {
      setState("lastOk", `${locale} · ${batch.length} strings`);
      if (batchCap.has(locale)) batchCap.set(locale, Math.min(BATCH_MAX, (batchCap.get(locale) ?? 1) * 2));
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      console.error(`[pdftek] translation to ${locale} failed`, msg);
      setState("lastError", `${locale}: ${msg}`);
      // A problem with this batch's text (too long, unreadable answer, a refusal): split it up and
      // carry on, and leave a single string that keeps failing in English, so one bad string can
      // never stall the translator.
      const batchProblem = err instanceof HttpError || status === 400 || status === 413;
      if (!batchProblem) {
        pausedUntil = Date.now() + 2 * 60_000; // the API itself: rate limits, billing, outages
        return;
      }
      if (batch.length > 1) batchCap.set(locale, Math.max(1, Math.floor(batch.length / 3)));
      else run("INSERT OR REPLACE INTO i18n_text (locale, source, text, created_at) VALUES (?, ?, ?, ?)", locale, batch[0].text, batch[0].text, now());
    })
    .finally(() => {
      busy--;
      batch.forEach((b) => texts.delete(b.text));
      batchesFor.set(locale, (batchesFor.get(locale) ?? 1) - 1);
    });
}

/**
 * Languages someone is reading right now come first and may use every slot, so a visitor who picks
 * a language sees it within minutes. The rest are translated in rotation in the background.
 */
async function tick() {
  if (Date.now() < pausedUntil) return;
  const allowed = (code: string) => code !== DEFAULT_LOCALE && (!ONLY.length || ONLY.includes(code));
  const demanded = all<{ locale: string }>("SELECT locale FROM i18n_demand WHERE at > ? ORDER BY at DESC", now() - 6 * 3_600_000)
    .map((r) => r.locale)
    .filter((c) => allowed(c) && LOCALES.some((l) => l.code === c));
  const others = LOCALES.map((l) => l.code).filter((c) => allowed(c) && !demanded.includes(c));
  rotate = (rotate + 1) % Math.max(1, others.length);
  const order = [...demanded, ...others.slice(rotate), ...others.slice(0, rotate)];
  for (const code of order) {
    const slots = demanded.includes(code) ? PARALLEL : 1;
    while (busy < PARALLEL && (batchesFor.get(code) ?? 0) < slots) {
      const batch = missing(code, inFlight.get(code) ?? new Set());
      if (!batch.length) break;
      start(code, batch);
    }
    if (busy >= PARALLEL) return;
  }
}

export function startTranslator() {
  if (started || process.env.PDFTEK_TRANSLATE === "0") return;
  started = true;
  void registerAll().catch((e) => console.error("[pdftek] i18n registration failed", e));
  if (!aiConfigured()) {
    console.info("[pdftek] translator idle: no Anthropic API key");
    setState("lastError", "No Anthropic API key: set ANTHROPIC_API_KEY on the server to translate the site.");
    return;
  }
  console.info("[pdftek] translator started");
  setInterval(() => void tick(), TICK_MS).unref?.();
  setTimeout(() => void tick(), 3000);
}

/** Progress per language, for the admin status page. */
export function translationStatus() {
  const total = all<{ n: number }>("SELECT count(*) AS n FROM i18n_source")[0]?.n ?? 0;
  const done = new Map(all<{ locale: string; n: number }>("SELECT locale, count(*) AS n FROM i18n_text GROUP BY locale").map((r) => [r.locale, r.n]));
  const state = Object.fromEntries(all<{ key: string; value: string; at: number }>("SELECT key, value, at FROM i18n_state").map((r) => [r.key, { message: r.value, at: new Date(r.at).toISOString() }]));
  return {
    translator: process.env.PDFTEK_TRANSLATE === "0" ? "switched off (PDFTEK_TRANSLATE=0)" : aiConfigured() ? "on" : "idle: no ANTHROPIC_API_KEY",
    strings: total,
    lastSuccess: state.lastOk ?? null,
    lastError: state.lastError ?? null,
    languages: LOCALES.filter((l) => l.code !== DEFAULT_LOCALE).map((l) => {
      const n = done.get(l.code) ?? 0;
      return { code: l.code, name: l.name, translated: n, percent: total ? Math.min(100, Math.round((n / total) * 100)) : 0 };
    }),
  };
}
