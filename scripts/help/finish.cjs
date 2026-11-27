// Turns the raw screenshots from capture.cjs into the WebP images the Help Center serves.
// Usage: node scripts/help/finish.cjs <raw png dir>
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const RAW = process.argv[2];
const OUT = path.join(__dirname, "..", "..", "public", "help", "shots");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  let bytes = 0;
  const files = fs.readdirSync(RAW).filter((f) => f.endsWith(".png") && !f.startsWith("_"));
  for (const f of files) {
    const img = sharp(path.join(RAW, f));
    const { width, height } = await img.metadata();
    // Phone screenshots stay narrow; desktop ones are shown up to 860px wide (1600 for sharp screens).
    const w = height > width ? 640 : 1600;
    const out = path.join(OUT, f.replace(/\.png$/, ".webp"));
    await img.resize({ width: Math.min(w, width) }).webp({ quality: 78, effort: 6 }).toFile(out);
    bytes += fs.statSync(out).size;
  }
  console.log(`${files.length} images, ${(bytes / 1e6).toFixed(1)} MB in ${OUT}`);
})();
