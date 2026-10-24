// Collects the English text shown in pdftek's interface into src/i18n/catalog.json, so it can be
// translated. Runs before every build (npm run build), so new text is picked up automatically.
//
// What counts as text:
//   - JSX text, and placeholder/title/aria-label/alt attributes
//   - strings shown from JSX expressions (ternaries, &&, arrays mapped into elements)
//   - values of display keys in object literals (label, title, desc, hint, …)
//   - messages passed to toast(), confirm(), errors and HttpError helpers
//   - t("…") calls
// Template literals become patterns: `Reading ${n} page${n > 1 ? "s" : ""}` → "Reading {0} page(s)".
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(SRC, "i18n", "catalog.json");
const OUT_SITE = path.join(SRC, "i18n", "catalog-site.json");
// Client components of the public website: their text is sent with the page (see app/layout.tsx), so
// it arrives translated instead of switching after load.
const SITE_FILES = [
  "src/components/marketing-menu.tsx",
  "src/components/pricing.tsx",
  "src/components/auth-form.tsx",
  "src/components/paywall.tsx",
  "src/components/i18n.tsx",
  "src/components/motion.tsx",
  "src/app/contact/contact-form.tsx",
  "src/app/forgot/forgot-form.tsx",
  "src/app/reset/reset-form.tsx",
  "src/app/auth/confirm/confirm.tsx",
  "src/lib/plans.ts",
];

const ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label"]);
const KEYS = new Set(["label", "sub", "title", "desc", "description", "hint", "drop", "lead", "body", "help", "note", "caption", "heading", "h1", "message", "tip", "question", "answer", "name", "purpose"]);
const CALLS = new Set(["toast", "confirm", "alert", "setError", "notifyPaywall", "t", "badRequest", "notFound", "forbidden", "unauthorized", "describe"]);
const ARRAY_KEYS = new Set(["steps", "benefits", "faq", "tips", "sections", "rows"]);
const SKIP_DIRS = new Set(["i18n"]);
const ENTITIES = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&rarr;": "→", "&larr;": "←", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&middot;": "·", "&times;": "×", "&copy;": "©" };
const decode = (s) => s.replace(/&[a-z]+;/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const strings = new Map(); // text -> Set(files)
const add = (text, file) => {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s || s.length > 600) return;
  if (!/\p{L}{2}/u.test(s.replace(/\{\d+\}|\(s\)/g, ""))) return; // needs real words
  if (/^(https?:|mailto:|\/|#|\.|[\w-]+\.(tsx?|css|png|svg|pdf|json))/.test(s)) return;
  if (/^[a-z0-9_-]+$/.test(s) && !/\s/.test(s) && s.length < 3) return;
  if (/^[a-z][a-zA-Z0-9]*$/.test(s) && /[A-Z]/.test(s)) return; // camelCase identifiers
  if (/^[a-z]+(_[a-z]+)+$/.test(s)) return; // snake_case codes
  if (/^[a-z0-9-]+\/[a-z0-9.+-]+$/i.test(s)) return; // mime types
  if (/^(btn|tool-btn|row|col|menu|chip|badge|input|select|icon-btn|mk-|ff-|fx-)/.test(s)) return; // class names
  if (!strings.has(s)) strings.set(s, new Set());
  strings.get(s).add(path.relative(ROOT, file));
};

const PLURAL = /\?\s*["'`]s["'`]\s*:\s*["'`]["'`]|\?\s*["'`]["'`]\s*:\s*["'`]s["'`]/;
function templateText(node, sf) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  let out = node.head.text;
  let n = 0;
  for (const span of node.templateSpans) {
    const expr = span.expression.getText(sf);
    out += PLURAL.test(expr) ? "(s)" : `{${n++}}`;
    out += span.literal.text;
  }
  return out;
}
const textOf = (node, sf) => (ts.isStringLiteral(node) ? node.text : ts.isTemplateLiteral(node) ? templateText(node, sf) : null);

/** Strings an expression can evaluate to when shown: walks ternaries, &&, ||, ?? and parentheses. */
function shownStrings(node, sf, file) {
  if (!node) return;
  const t = textOf(node, sf);
  if (t !== null) return add(t, file);
  if (ts.isParenthesizedExpression(node)) return shownStrings(node.expression, sf, file);
  if (ts.isConditionalExpression(node)) {
    shownStrings(node.whenTrue, sf, file);
    shownStrings(node.whenFalse, sf, file);
    return;
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    shownStrings(node.right, sf, file);
    if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) shownStrings(node.left, sf, file);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) node.elements.forEach((e) => shownStrings(e, sf, file));
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function visit(node, sf, file) {
  if (ts.isJsxText(node)) add(decode(node.text), file);
  else if (ts.isJsxAttribute(node) && node.initializer) {
    const name = node.name.getText(sf);
    if (ARRAY_KEYS.has(name) && ts.isJsxExpression(node.initializer)) deepArray(node.initializer.expression, sf, file);
    if (ATTRS.has(name)) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer.text, file);
      else if (ts.isJsxExpression(node.initializer)) shownStrings(node.initializer.expression, sf, file);
    }
  } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
    shownStrings(node.expression, sf, file);
    // Arrays of display rows mapped into elements: [["Heading", "Body"], …].map(…)
    let e = node.expression;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      let base = e.expression.expression;
      while (ts.isParenthesizedExpression(base) || ts.isAsExpression(base)) base = base.expression;
      if (ts.isConditionalExpression(base)) [base.whenTrue, base.whenFalse].forEach((b) => deepArray(b, sf, file));
      else deepArray(base, sf, file);
    }
  } else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && KEYS.has(node.name.text)) {
    shownStrings(node.initializer, sf, file);
  } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ARRAY_KEYS.has(node.name.text)) {
    deepArray(node.initializer, sf, file);
  } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z][A-Z0-9_]+$/.test(node.name.text) && node.initializer) {
    if (!/MONTH/.test(node.name.text)) deepArray(node.initializer, sf, file);
    // Lookup tables of labels: const STATUS = { pending: ["Sent", "badge-muted"], … }, const LABEL = { any: "Any file" }.
    let init = node.initializer;
    while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
    // Tables of fonts, formats, months or routes are data, not text people read.
    if (ts.isObjectLiteralExpression(init) && !/FONT|FAMIL|MONTH|MIME|EXT|COLOR|OFFICE|TASKS|ROUTE|PATH|OPS|EQUIV|CANON|SCHEMA/.test(node.name.text))
      for (const prop of init.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const label = (t) => t !== null && !/^[?/#]/.test(t) && !/^[a-z]+$/.test(t);
        const one = textOf(prop.initializer, sf);
        if (one !== null) {
          if (label(one)) add(one, file);
        } else {
          shownStrings(prop.initializer, sf, file);
          deepArray(prop.initializer, sf, file);
        }
      }
  } else if (ts.isCallExpression(node) && CALLS.has(calleeName(node))) {
    const name = calleeName(node);
    const arg = node.arguments[0];
    if (name === "notifyPaywall" && arg && ts.isObjectLiteralExpression(arg)) {
      // handled by the "message" key
    } else shownStrings(arg, sf, file);
  } else if (ts.isNewExpression(node) && node.arguments?.length) {
    const name = node.expression.getText(sf);
    if (name === "HttpError") shownStrings(node.arguments[1], sf, file);
    else if (name === "Error") shownStrings(node.arguments[0], sf, file);
  }
  ts.forEachChild(node, (c) => visit(c, sf, file));
}

function deepArray(node, sf, file) {
  if (!node) return;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  if (!ts.isArrayLiteralExpression(node)) return;
  for (const el of node.elements) {
    if (ts.isArrayLiteralExpression(el)) el.elements.forEach((x) => shownStrings(x, sf, file));
    else shownStrings(el, sf, file);
  }
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name));
    } else if (/\.(tsx?|mts)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
      const file = path.join(dir, ent.name);
      const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      visit(sf, sf, file);
    }
  }
}

walk(SRC);
const list = [...strings.keys()].sort();
const site = list.filter((s) => [...strings.get(s)].some((f) => SITE_FILES.includes(f)));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const write = (file, data) => {
  const next = JSON.stringify(data, null, 1) + "\n";
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== next) fs.writeFileSync(file, next);
};
write(OUT, list);
write(OUT_SITE, site);
const words = list.reduce((n, s) => n + s.split(/\s+/).length, 0);
console.log(`[i18n] ${list.length} strings (${site.length} website), ${words} words → ${path.relative(ROOT, OUT)}`);
