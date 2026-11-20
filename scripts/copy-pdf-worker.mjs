// Copies the pdf.js worker into /public so browsers can load it from our own origin.
import fs from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dest = path.join(process.cwd(), "public/pdf.worker.min.mjs");
if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
