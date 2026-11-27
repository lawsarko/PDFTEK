// Renders the title card that opens each guide video, and the closing card.
// Usage: node scripts/help/cards.cjs <guides.json> <out dir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [json, out] = process.argv.slice(2);
const { categories, guides } = JSON.parse(fs.readFileSync(json, "utf8"));
fs.mkdirSync(out, { recursive: true });

const LOGO = `<svg width="64" height="64" viewBox="0 0 32 32"><path d="M8 4h11l6 6v18H8z" fill="#b84a0b"/><path d="M19 4v6h6" fill="#f6a878"/><rect x="11" y="14" width="10" height="2.2" rx="1" fill="#fff"/><rect x="11" y="18.5" width="7" height="2.2" rx="1" fill="#ffffffc7"/><rect x="11" y="23" width="8.5" height="2.2" rx="1" fill="#ffffffc7"/></svg>`;
const css = `body{margin:0;width:1920px;height:1200px;font-family:Roboto,"Helvetica Neue",Arial,sans-serif;background:radial-gradient(1200px 700px at 15% 0%,#fff1e7 0%,#fbe3d4 45%,#f3d2bf 100%);color:#1f1a17;display:flex;flex-direction:column;justify-content:center;padding:0 160px;box-sizing:border-box;overflow:hidden}
.brand{display:flex;align-items:center;gap:18px;font-weight:700;letter-spacing:.16em;font-size:34px;position:absolute;top:96px;left:160px}.brand b{color:#b84a0b}
.cat{display:inline-block;font-size:30px;font-weight:500;color:#5c1f00;background:#ffdbc9;border-radius:28px;padding:10px 26px;margin-bottom:34px;width:fit-content}
h1{font-size:96px;line-height:1.08;font-weight:500;margin:0 0 30px;letter-spacing:-.02em;max-width:1500px}
p{font-size:40px;line-height:1.4;color:#52443b;margin:0;max-width:1400px}
.foot{position:absolute;bottom:90px;left:160px;font-size:28px;color:#7a6c62}
.blob{position:absolute;right:-220px;bottom:-260px;width:900px;height:900px;border-radius:50%;background:#b84a0b;opacity:.08}`;
const page = (cat, title, sub) =>
  `<html><head><style>${css}</style></head><body><div class="blob"></div><div class="brand">${LOGO}<span>PDF<b>TEK</b></span></div>${cat ? `<div class="cat">${cat}</div>` : ""}<h1>${title}</h1><p>${sub}</p><div class="foot">pdftek.com/help</div></body></html>`;

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const p = await b.newPage({ viewport: { width: 1920, height: 1200 } });
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  for (const g of guides) {
    const cat = categories.find((c) => c.key === g.category)?.title ?? "";
    await p.setContent(page(esc(cat), esc(g.title), esc(g.summary)));
    await p.screenshot({ path: path.join(out, `${g.slug}.png`) });
  }
  await p.setContent(page("", "That’s it.", "Find every guide and video in the pdftek Help Center."));
  await p.screenshot({ path: path.join(out, "_outro.png") });
  await b.close();
  console.log(`${guides.length + 1} cards in ${out}`);
})();
