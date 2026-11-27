// Prints the Help Center guides as JSON (for the screenshot and video scripts).
// Usage: npx tsx scripts/help/guides-json.mts > guides.json
const m = (await import("../../src/lib/help/guides.ts")) as Record<string, unknown> & { default?: Record<string, unknown> };
const src = (m.GUIDES ? m : m.default) as { CATEGORIES: unknown; GUIDES: unknown };
console.log(JSON.stringify({ categories: src.CATEGORIES, guides: src.GUIDES }, null, 2));
