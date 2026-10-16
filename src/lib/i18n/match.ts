/**
 * Looks up translations for interface text. Exact strings come first; then patterns, where
 * "{0}" stands for a value (a number or a name) and "(s)" for an optional English plural ending:
 * "Reading {0} page(s)…" matches "Reading 3 pages…" and fills the value into the translation.
 */
export type Dict = { exact: Record<string, string>; patterns: [string, string][] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isPattern = (s: string) => /\{\d+\}|\(s\)/.test(s);

/** Collapses whitespace so text from JSX and from the DOM compare equal. */
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function compile(dict: Dict) {
  type P = { re: RegExp; order: string[]; tr: string };
  // Patterns are grouped by their first two letters, so a lookup tests only the few that could match.
  const byStart = new Map<string, P[]>();
  const anyStart: P[] = [];
  for (const [src, tr] of dict.patterns) {
    // Patterns that are mostly placeholders would match anything.
    if (src.replace(/\{\d+\}|\(s\)/g, "").replace(/[^\p{L}]/gu, "").length < 3) continue;
    const order: string[] = [];
    const re = src.split(/(\{\d+\}|\(s\))/).map((part) => {
      if (/^\{\d+\}$/.test(part)) {
        order.push(part);
        return "(.+?)";
      }
      if (part === "(s)") return "s?";
      return esc(part);
    });
    let p: P;
    try {
      p = { re: new RegExp(`^${re.join("")}$`), order, tr };
    } catch {
      continue;
    }
    const lead = src.split(/\{\d+\}|\(s\)/)[0];
    if (lead.length >= 2) {
      const k = lead.slice(0, 2);
      byStart.set(k, [...(byStart.get(k) ?? []), p]);
    } else anyStart.push(p);
  }
  return (text: string): string | null => {
    const key = norm(text);
    if (!key) return null;
    const hit = dict.exact[key];
    if (hit !== undefined) return hit;
    for (const list of [byStart.get(key.slice(0, 2)), anyStart]) {
      if (!list) continue;
      for (const p of list) {
        const m = p.re.exec(key);
        if (!m) continue;
        let out = p.tr;
        p.order.forEach((ph, i) => (out = out.split(ph).join(m[i + 1])));
        return out.replace(/\{\d+\}/g, "");
      }
    }
    return null;
  };
}

/** Replaces {name} placeholders with values. */
export function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
