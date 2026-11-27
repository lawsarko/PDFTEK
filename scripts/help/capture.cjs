// Takes the Help Center screenshots from the real app, with the control each step talks about
// outlined in orange. Run against a pdftek server started for this (fresh data, mock AI, email sink):
//
//   node scripts/help/capture.cjs --base http://localhost:3200 --db <DATA_DIR>/pdftek.db \
//        --samples <dir from samples.cjs> --mail <email sink dir> --out <raw png dir> [--only name,name]
//
// Then scripts/help/finish.cjs turns the PNGs into the WebP files in public/help/shots.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://localhost:3200");
const DB = arg("db");
const SAMPLES = arg("samples");
const MAIL = arg("mail");
const OUT = arg("out");
const ONLY = arg("only", "") ? new Set(arg("only").split(",")) : null;
const STATE = path.join(OUT, "state.json");
fs.mkdirSync(OUT, { recursive: true });

const db = () => new DatabaseSync(DB);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/** Outlines an element (or several) like a presenter's highlight. */
async function mark(page, sel, opts = {}) {
  await page.evaluate(
    ({ sel, pad, radius }) => {
      const els = (Array.isArray(sel) ? sel : [sel]).flatMap((s) => {
        const e = document.querySelector(s);
        return e ? [e] : [];
      });
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const d = document.createElement("div");
        d.className = "__help_mark";
        Object.assign(d.style, {
          position: "fixed",
          left: `${r.left - pad}px`,
          top: `${r.top - pad}px`,
          width: `${r.width + pad * 2}px`,
          height: `${r.height + pad * 2}px`,
          border: "3px solid #f0884a",
          borderRadius: `${radius}px`,
          boxShadow: "0 0 0 6px rgba(240,136,74,.28)",
          zIndex: 2147483647,
          pointerEvents: "none",
        });
        document.body.appendChild(d);
      }
    },
    { sel, pad: opts.pad ?? 5, radius: opts.radius ?? 14 },
  );
}
const unmark = (page) => page.evaluate(() => document.querySelectorAll(".__help_mark").forEach((e) => e.remove()));

async function shot(page, id, opts = {}) {
  if (opts.mark) await mark(page, opts.mark, opts);
  await sleep(opts.wait ?? 250);
  await page.screenshot({ path: path.join(OUT, `${id}.png`), ...(opts.clip ? { clip: opts.clip } : {}) });
  await unmark(page);
  log("  shot", id);
}

async function newContext(browser, phone) {
  const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 / 3 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("pdftek-tour", "done");
    } catch {}
  });
  return ctx;
}

/* --------------------------------------------------------------------------------- setup */
async function setup(browser) {
  if (fs.existsSync(STATE)) return JSON.parse(fs.readFileSync(STATE, "utf8"));
  const ctx = await newContext(browser);
  const p = await ctx.newPage();
  const email = "alex@morganco.example";
  const r = await p.request.post(`${BASE}/api/auth/signup`, { data: { name: "Alex Morgan", email, password: "help-demo-2026" } });
  if (!r.ok()) throw new Error(`signup ${r.status()} ${await r.text()}`);
  await p.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const wid = p.url().split("/app/")[1].split(/[/?]/)[0];
  const d = db();
  d.prepare("UPDATE workspaces SET plan='pro', name='Morgan & Co.', credits=550 WHERE id=?").run(wid);
  d.prepare("UPDATE users SET email_verified_at=created_at WHERE email=?").run(email);
  const docs = {};
  // Oldest first so the agreement ends up at the top of Home.
  for (const f of ["Mutual NDA - Lumen Studio.pdf", "Employee details form.pdf", "Lease scan.pdf", "Invoice INV-2041.pdf", "Bank statement March 2026.pdf", "Q1 board report.pdf", "Northwind service agreement.pdf"]) {
    const res = await p.request.post(`${BASE}/api/workspaces/${wid}/documents`, { multipart: { files: { name: f, mimeType: "application/pdf", buffer: fs.readFileSync(path.join(SAMPLES, f)) } } });
    const j = await res.json();
    docs[f] = j.documents[0].id;
    await sleep(1100);
  }
  const tag = (f, tags) => p.request.patch(`${BASE}/api/documents/${docs[f]}`, { data: { tags } });
  await tag("Northwind service agreement.pdf", ["contracts", "northwind"]);
  await tag("Mutual NDA - Lumen Studio.pdf", ["contracts"]);
  await tag("Invoice INV-2041.pdf", ["finance", "northwind"]);
  await tag("Bank statement March 2026.pdf", ["finance"]);
  const state = { email, password: "help-demo-2026", wid, docs, storage: path.join(OUT, "auth.json") };
  await ctx.storageState({ path: state.storage });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  await ctx.close();
  return state;
}

/* --------------------------------------------------------------------------------- sections */
const SECTIONS = {};

SECTIONS.site = async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 / 3 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await sleep(6000); // the headline types itself out
  await shot(p, "site-home", { mark: ".mk-hero .btn-primary, .g-hero .btn-primary, .mk-cta .btn-primary" });
  await ctx.close();
};

SECTIONS.home = async ({ s, page: p }) => {
  const doc = s.docs["Northwind service agreement.pdf"];
  await p.goto(`${BASE}/app/${s.wid}`, { waitUntil: "networkidle" });
  await sleep(2500); // thumbnails
  await shot(p, "home");
  await shot(p, "home-nav", { mark: ".wb-nav", radius: 20 });
  await shot(p, "home-convert", { mark: ".wb-qc:first-child" });
  await p.click(".wb-new");
  await shot(p, "new-menu", { mark: [".wb-nav .menu"] });
  await p.click(".wb-nav .menu-item:has-text('From Google Drive')");
  await sleep(800);
  await shot(p, "upload-cloud", { mark: ".modal" , radius: 28});
  await p.keyboard.press("Escape");
  await sleep(400);
  await p.click(".wb-chip:has-text('#contracts')");
  await sleep(300);
  await shot(p, "home-filters", { mark: [".wb-chips", ".wb-seg"] });
  await p.click(".wb-chip:has-text('#contracts')");
  await p.locator(".wb-card", { hasText: "Northwind service" }).locator(".wb-card-more").click();
  await shot(p, "card-menu", { mark: ".wb-card .menu" });
  await p.mouse.click(1000, 120);
  // trash: put the NDA in, then show the Trash window
  await p.request.delete(`${BASE}/api/documents/${s.docs["Mutual NDA - Lumen Studio.pdf"]}`);
  await p.reload({ waitUntil: "networkidle" });
  await sleep(1200);
  await p.click(".wb-ni:has-text('Trash')");
  await sleep(800);
  await shot(p, "trash", { mark: ".modal .list-item .btn" });
  await p.click(".modal .btn:has-text('Restore')");
  await sleep(800);
  await p.keyboard.press("Escape");
  // search
  await p.goto(`${BASE}/app/${s.wid}`, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot(p, "search-box", { mark: ".wb-top-search", radius: 30 });
  await p.click(".wb-top-search input");
  await p.keyboard.type("renew", { delay: 40 });
  await sleep(1200);
  await shot(p, "search-results", { mark: ".search-results", radius: 18 });
  await shot(p, "search-ask", { mark: ".wb-ask-hit", radius: 12 });
  await p.locator(".search-results .search-hit", { hasText: "p.1" }).first().click();
  await sleep(2500);
  await shot(p, "search-jump");
  // the document view
  await p.goto(`${BASE}/app/${s.wid}?doc=${doc}`, { waitUntil: "networkidle" });
  await sleep(2500);
  await shot(p, "doc", { mark: ".wb-dtop .wb-ibtn[aria-label='Copy link']", radius: 22 });
  await shot(p, "doc-back", { mark: ".wb-dtop [aria-label='Back to home']", radius: 22 });
  await shot(p, "thumbs", { mark: [".wb-pages", ".wb-pctrl"], radius: 18 });
  await shot(p, "tools-convert", { mark: ".wb-tools .wb-tg:first-child", radius: 16 });
  await p.click(".wb-ti:has-text('More formats')");
  await shot(p, "more-formats", { mark: ".wb-tools .menu" });
  await p.mouse.click(900, 400);
  const dl = p.waitForEvent("download", { timeout: 60000 });
  await p.click(".wb-ti:has-text('To Word')");
  await dl;
  await sleep(300);
  await shot(p, "converted", { mark: ".toast, .toasts", radius: 10 });
  // more menu, handoff, versions
  await sleep(4000);
  await p.click(".wb-dtop [aria-label='More actions']");
  await shot(p, "more-menu", { mark: ".wb-dtop .menu" });
  await p.click(".menu-item:has-text('Hand off')");
  await sleep(800);
  await shot(p, "handoff", { mark: ".modal", radius: 28 });
  await p.keyboard.press("Escape");
  await p.click(".wb-dtop [aria-label='More actions']");
  await p.click(".menu-item:has-text('Version history')");
  await sleep(1000);
  await shot(p, "versions", { mark: ".modal", radius: 28 });
  await p.keyboard.press("Escape");
};

const open = async (p, s, file) => {
  await p.goto(`${BASE}/app/${s.wid}?doc=${s.docs[file]}`, { waitUntil: "networkidle" });
  await sleep(2200);
};
const tool = (label) => `.wb-ti:has(.grow:text-is("${label}"))`;
/** CSS for the outline (Playwright's :has-text isn't CSS); finds the tool button's index. */
async function markTool(p, label) {
  const i = await p.locator(".wb-ti").evaluateAll((els, l) => els.findIndex((e) => (e.querySelector(".grow")?.textContent ?? "").trim() === l), label);
  await p.evaluate((i) => document.querySelectorAll(".wb-ti")[i]?.setAttribute("data-help", "1"), i);
  return ".wb-ti[data-help='1']";
}
async function toolShot(p, label, id) {
  const sel = await markTool(p, label);
  await p.locator(sel).scrollIntoViewIfNeeded();
  await shot(p, id, { mark: sel, radius: 12 });
  await p.evaluate(() => document.querySelectorAll("[data-help]").forEach((e) => e.removeAttribute("data-help")));
}
const modalShot = async (p, id, extra = {}) => {
  await sleep(900);
  await shot(p, id, { mark: ".modal", radius: 28, ...extra });
};
const closeModal = async (p) => {
  await p.keyboard.press("Escape");
  await sleep(400);
};

SECTIONS.tools = async ({ s, page: p }) => {
  await open(p, s, "Northwind service agreement.pdf");
  await toolShot(p, "Files → PDF", "topdf");
  await p.click(tool("Files → PDF"));
  await modalShot(p, "topdf-modal");
  await closeModal(p);
  for (const [label, id] of [["Merge", "merge"], ["Split", "split"], ["Extract pages", "extract-pages"], ["Organize pages", "organize"], ["Compress", "compress"], ["Watermark", "watermark"], ["Page numbers", "page-numbers"], ["Properties", "metadata"], ["Add password", "protect"], ["Remove password", "unlock"]]) {
    if (id === "organize") await toolShot(p, label, "organize-tool");
    if (id === "compress") await toolShot(p, label, "compress-tool");
    await p.locator(tool(label)).first().scrollIntoViewIfNeeded();
    await p.locator(tool(label)).first().click();
    await modalShot(p, id, id === "organize" ? { wait: 2500 } : {});
    await closeModal(p);
  }
  await toolShot(p, "Compare", "compare-tool");
  await toolShot(p, "Read PDF", "read-tool");
  await p.locator(tool("Read PDF")).click();
  await sleep(1500);
  await shot(p, "read", { mark: ".read-aloud, .tts-bar, .viewer-float", radius: 18 });
  await p.locator(tool("Stop reading")).click().catch(() => {});
  await toolShot(p, "Translate", "translate-tool");
  await p.locator(tool("Translate")).click();
  await modalShot(p, "translate");
  await closeModal(p);
  // images to PDF and the scanner, from Home
  await p.goto(`${BASE}/app/${s.wid}`, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot(p, "scan-open", { mark: ".wb-qc:nth-child(5)" });
  await p.click(".wb-new");
  await p.click(".wb-nav .menu-item:has-text('Images to PDF')");
  await modalShot(p, "images-pdf");
  await closeModal(p);
  await p.click(".wb-qc:nth-child(5)");
  await sleep(3500);
  await shot(p, "scan-modal", { mark: ".modal", radius: 28 });
  await closeModal(p);
  // scans and OCR
  await p.locator(".wb-tag.o").first().scrollIntoViewIfNeeded();
  await shot(p, "scan-badge", { mark: ".wb-tag.o", radius: 8 });
  await open(p, s, "Lease scan.pdf");
  await shot(p, "scan-ocr", { mark: ".wb-notice .btn", radius: 20 });
  await p.click(".wb-notice .btn");
  await modalShot(p, "ocr");
  await closeModal(p);
};

SECTIONS.edit = async ({ s, page: p }) => {
  await open(p, s, "Northwind service agreement.pdf");
  await toolShot(p, "Edit PDF", "edit-tool");
  await p.click(tool("Edit PDF"));
  await sleep(3500);
  // click a heading to edit it in place
  const run = p.locator(".edit-run").nth(3);
  await run.click().catch(() => {});
  await sleep(800);
  await shot(p, "edit", { mark: ".edit-input, .edit-run.selected", radius: 6 });
  await p.keyboard.press("Escape");
  await shot(p, "edit-toolbar", { mark: ".edit-toolbar", radius: 28 });
  // add a note so saving makes a new version
  await p.click(".edit-toolbar .tool-btn:has-text('Add text')");
  const box = await p.locator(".pdf-page").first().boundingBox();
  await p.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.12);
  await sleep(500);
  await p.keyboard.type("Reviewed by AM", { delay: 30 });
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
  await sleep(600);
  await shot(p, "edit-save", { mark: ".wb-canvas > .viewer-toolbar .btn-primary", radius: 22 });
  await p.click(".wb-canvas > .viewer-toolbar .btn-primary");
  await sleep(4000);
  // redact
  await open(p, s, "Northwind service agreement.pdf");
  await toolShot(p, "Redact", "redact-tool");
  await p.click(tool("Redact"));
  await sleep(3500);
  const b2 = await p.locator(".pdf-page").first().boundingBox();
  await p.mouse.move(b2.x + b2.width * 0.12, b2.y + b2.height * 0.255);
  await p.mouse.down();
  await p.mouse.move(b2.x + b2.width * 0.62, b2.y + b2.height * 0.272, { steps: 8 });
  await p.mouse.up();
  await sleep(600);
  await shot(p, "redact", { mark: ".edit-toolbar .tool-btn.active", radius: 18 });
  await p.click(".wb-canvas > .viewer-toolbar .btn:has-text('Cancel')");
  await sleep(1000);
  // versions and compare (there are two versions now)
  await open(p, s, "Northwind service agreement.pdf");
  await p.click(".wb-dtop [aria-label='More actions']");
  await p.click(".menu-item:has-text('Version history')");
  await modalShot(p, "versions");
  await closeModal(p);
  const v = await (await p.request.get(`${BASE}/api/documents/${s.docs["Northwind service agreement.pdf"]}/versions`)).json();
  const old = v.versions[v.versions.length - 1].id;
  await p.goto(`${BASE}/app/${s.wid}/compare?a=${s.docs["Northwind service agreement.pdf"]}&av=${old}&b=${s.docs["Northwind service agreement.pdf"]}`, { waitUntil: "networkidle" });
  await sleep(1500);
  await p.click("button.btn-primary:has-text('Compare')").catch(() => {});
  await sleep(5000);
  await shot(p, "compare");
};

SECTIONS.sign = async ({ s, page: p }) => {
  // the form filler
  await open(p, s, "Employee details form.pdf");
  await toolShot(p, "Fill form", "fill-tool");
  await p.click(tool("Fill form"));
  await sleep(4000);
  await p.click(".ff-tabs button:has-text('AI assist')");
  await sleep(600);
  await p.click(".ff-ai-btn");
  await sleep(5000);
  await shot(p, "fill", { mark: ".ff-panel", radius: 16 });
  await shot(p, "fill-save", { mark: ".app-shell-top .btn-primary", radius: 22 });
  // request signatures
  await open(p, s, "Northwind service agreement.pdf");
  await p.evaluate(() => [...document.querySelectorAll(".wb-dtop .wb-btn")].find((b) => b.textContent.includes("Request signature"))?.setAttribute("data-help", "1"));
  await shot(p, "sign-button", { mark: ".wb-dtop [data-help]", radius: 22 });
  await p.click(".wb-dtop .wb-btn:has-text('Request signature')");
  await sleep(4000);
  await p.locator("input[placeholder='Full name']").first().fill("Dana Whitfield");
  await p.locator("input[placeholder='email@company.com']").first().fill("dana@northwind.example");
  const place = async () => {
    await p.locator("button:text-is('Signature')").first().click();
    const pg = await p.locator(".pdf-page").first().boundingBox();
    await p.mouse.click(pg.x + pg.width * 0.3, Math.min(pg.y + pg.height * 0.8, 760));
    await sleep(600);
  };
  await place();
  await shot(p, "send", { mark: ".sig-field", radius: 6 });
  await p.goto(`${BASE}/app/${s.wid}/send/${s.docs["Mutual NDA - Lumen Studio.pdf"]}?mode=template`, { waitUntil: "networkidle" });
  await sleep(3500);
  await p.locator("input[aria-label='Role name']").first().fill("Client").catch(() => {});
  await place();
  await shot(p, "template", { mark: ".sig-field", radius: 6 });
  await p.locator(".app-shell-top .btn-primary").click();
  await sleep(2500);
  // a sent envelope so the hub has something in it
  await p.request.post(`${BASE}/api/workspaces/${s.wid}/signatures`, { data: { documentId: s.docs["Northwind service agreement.pdf"], title: "Northwind service agreement", message: "", sequential: false, signers: [{ key: "s1", name: "Dana Whitfield", email: "dana@northwind.example" }, { key: "s2", name: "Alex Morgan", email: s.email }], fields: [{ signerKey: "s1", kind: "signature", page: 3, x: 0.1, y: 0.3, w: 0.3, h: 0.06 }, { signerKey: "s2", kind: "signature", page: 3, x: 0.55, y: 0.3, w: 0.3, h: 0.06 }] } });
  await p.goto(`${BASE}/app/${s.wid}/signatures`, { waitUntil: "networkidle" });
  await sleep(2000);
  await shot(p, "signatures");
  await p.locator("button:has-text('New signing link'), button:has-text('Signing link')").first().click().catch(() => {});
  await sleep(1200);
  await shot(p, "signing-link", { mark: ".modal", radius: 28 });
  await closeModal(p);
  // bank statement to Excel
  await open(p, s, "Bank statement March 2026.pdf");
  await toolShot(p, "Statement → Excel", "to-excel-tool");
  await p.click(tool("Statement → Excel"));
  await sleep(9000);
  await shot(p, "to-excel");
};

SECTIONS.ai = async ({ s, page: p }) => {
  // start from an empty conversation (so the section can be re-run)
  await p.request.delete(`${BASE}/api/documents/${s.docs["Northwind service agreement.pdf"]}/chat`);
  await p.request.delete(`${BASE}/api/workspaces/${s.wid}/chat`);
  await open(p, s, "Northwind service agreement.pdf");
  await p.click(".wb-dtop .wb-btn:has-text('Ask AI')");
  await sleep(1500);
  await shot(p, "ai-open", { mark: [".wb-dtop .wb-btn.tonal", ".wb-ai"], radius: 20 });
  await shot(p, "ai-suggest", { mark: [".wb-sum", ".wb-ai .suggestions"], radius: 16 });
  await p.click(".wb-sum .btn");
  await sleep(4000);
  await shot(p, "ai-answer", { mark: ".wb-ai .cite", radius: 10 });
  await p.click(".wb-ai button:has-text('Whole library')");
  await sleep(1500);
  await p.locator(".wb-ai .suggestions .chip").first().click().catch(() => {});
  await sleep(4000);
  await p.evaluate(() => [...document.querySelectorAll(".wb-ai button")].find((b) => b.textContent.includes("Whole library"))?.setAttribute("data-help", "1"));
  await shot(p, "ai-library", { mark: [".wb-ai button[data-help]", ".wb-ai .msg-ai"], radius: 10 });
  // extract
  await p.click(".wb-ai .tab:has-text('Extract')");
  await sleep(1000);
  await shot(p, "extract", { mark: ".wb-ai .panel-body", radius: 16 });
  await p.click(".wb-ai .menu-item:has-text('Key terms')");
  await sleep(5000);
  await p.locator(".wb-ai table").first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(400);
  await shot(p, "extract-result", { mark: ".wb-ai table", radius: 10 });
  // automations
  await p.click(".wb-ai .tab:has-text('Automate')");
  await sleep(1200);
  await shot(p, "automate", { mark: ".wb-ai .panel-body", radius: 16 });
  await p.click(".wb-ai .flow:has-text('Renewal reminders')").catch(() => {});
  await sleep(1200);
  await shot(p, "automate-edit", { mark: ".modal", radius: 28 });
  await closeModal(p);
  // playbook
  await p.goto(`${BASE}/app/${s.wid}/settings?tab=playbook`, { waitUntil: "networkidle" });
  await sleep(1200);
  const ta = p.locator("textarea").first();
  await ta.fill("Liability cap: at least 12 months of fees.\nNo automatic renewal longer than 12 months without a 30-day notice window.\nPayment terms: net 30 or longer.\nGoverning law: Oregon or Washington.");
  await shot(p, "playbook", { mark: "textarea", radius: 10 });
};

SECTIONS.clients = async ({ s, page: p }) => {
  // document requests (no account needed)
  await p.goto(`${BASE}/app/${s.wid}/requests?new=1`, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot(p, "requests-new");
  await p.request.post(`${BASE}/api/workspaces/${s.wid}/requests`, { data: { title: "Rental application documents", message: "Please upload these so we can process your application.", recipientName: "Sam Rivera", recipientEmail: "sam.rivera@example.com", dueDate: "2026-12-15", items: [{ label: "Photo ID", note: "Front and back", accept: "image" }, { label: "Proof of income", note: "Last 2 pay stubs" }, { label: "Last 2 bank statements", accept: "pdf" }], verify: "email", autoRemind: true } });
  await p.goto(`${BASE}/app/${s.wid}/requests`, { waitUntil: "networkidle" });
  await sleep(1500);
  await p.locator(".rq-list button:not(.btn)").first().click().catch(() => {});
  await sleep(1200);
  await shot(p, "requests");
  // firm
  await p.goto(`${BASE}/app/${s.wid}/clients/settings`, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot(p, "firm-settings");
  const add = (c) => p.request.post(`${BASE}/api/workspaces/${s.wid}/clients`, { data: c });
  const people = [
    { name: "Jordan Lee", email: "jordan.lee@example.com", kind: "individual", tags: ["Onboarding"] },
    { name: "Harbor Realty", email: "accounts@harborrealty.example", kind: "business", company: "Harbor Realty LLC", tags: ["Bookkeeping"] },
    { name: "Priya Shah", email: "priya@example.com", kind: "individual" },
    { name: "Fernwood Dental", email: "office@fernwood.example", kind: "business", company: "Fernwood Dental PC" },
  ];
  const ids = [];
  for (const c of people) ids.push((await (await add(c)).json()).client?.id);
  s.clientId = ids[0];
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  // a request so the dashboard has progress
  await p.request.post(`${BASE}/api/workspaces/${s.wid}/clients/${ids[0]}`, { data: { action: "request", spec: { title: "Onboarding documents", message: "Welcome aboard! Please upload the documents below so we can get started.", items: [{ label: "Photo ID", note: "Driver's license or passport", required: true, accept: "image" }, { label: "Signed engagement letter", note: "", required: true, accept: "pdf" }, { label: "W-9", note: "", required: true, accept: "pdf" }], verify: "email", autoRemind: true } } });
  await p.goto(`${BASE}/app/${s.wid}/clients`, { waitUntil: "networkidle" });
  await sleep(1800);
  await shot(p, "clients-dash");
  await p.click("button:has-text('Add client')");
  await sleep(800);
  await p.locator(".modal input").first().fill("Maya Chen");
  await p.locator(".modal input[type=email]").first().fill("maya.chen@example.com").catch(() => {});
  await modalShot(p, "client-add");
  await closeModal(p);
  await p.goto(`${BASE}/app/${s.wid}/clients/${ids[0]}`, { waitUntil: "networkidle" });
  await sleep(1800);
  await shot(p, "client-profile");
  await p.locator("button:has-text('Request documents')").first().click();
  await sleep(1000);
  await p.locator(".fa-chip-btn:has-text('Employee onboarding')").click().catch(() => {});
  await sleep(400);
  await modalShot(p, "client-request");
  await closeModal(p);
};

SECTIONS.portal = async ({ browser, s }) => {
  const slug = (db().prepare("SELECT firm_slug FROM workspaces WHERE id=?").get(s.wid) || {}).firm_slug;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 / 3 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/portal/${slug}`, { waitUntil: "networkidle" });
  await sleep(1000);
  await p.locator("input[type=email]").fill("jordan.lee@example.com");
  await shot(p, "portal-login", { mark: "form, .pt-card", radius: 20 });
  const before = new Set(fs.readdirSync(MAIL));
  await p.click("button.btn-primary");
  await sleep(2500);
  const mail = fs.readdirSync(MAIL).filter((f) => !before.has(f)).map((f) => fs.readFileSync(path.join(MAIL, f), "utf8")).join("\n");
  const code = (mail.replace(/=\r?\n/g, "").match(/\b(\d{6})\b/) || [])[1];
  if (code) {
    await p.locator("input").first().fill(code);
    await p.keyboard.press("Enter");
    await sleep(3000);
  }
  await shot(p, "portal-home");
  await ctx.close();
  // the firm's side of the conversation
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 / 3, storageState: s.storage })).newPage();
  await p2.request.post(`${BASE}/api/workspaces/${s.wid}/clients/${s.clientId}`, { data: { action: "message", body: "Hi Jordan, thanks for joining. Your onboarding checklist is in the portal; reply here with any questions." } });
  await p2.goto(`${BASE}/app/${s.wid}/clients/messages`, { waitUntil: "networkidle" });
  await sleep(1500);
  await p2.locator(".fa-thread-item, .fa-inbox-item, li").first().click().catch(() => {});
  await sleep(1200);
  await shot(p2, "client-messages");
};

SECTIONS.account = async ({ s, page: p }) => {
  await p.goto(`${BASE}/app/${s.wid}`, { waitUntil: "networkidle" });
  await sleep(1500);
  await p.click(".wb-ws");
  await shot(p, "ws-menu", { mark: ".ws-wrap .menu" });
  await p.mouse.click(700, 400);
  await p.click(".wb-avatar");
  await shot(p, "account-menu", { mark: ".wb-top .menu-wrap:last-child .menu" });
  await p.click(".menu-item:has-text('English')").catch(() => {});
  await sleep(900);
  await shot(p, "language", { mark: ".modal", radius: 28 });
  await closeModal(p);
  await p.evaluate(() => localStorage.setItem("pdftek-theme", "dark"));
  await p.reload({ waitUntil: "networkidle" });
  await sleep(2500);
  await shot(p, "dark");
  await p.evaluate(() => localStorage.setItem("pdftek-theme", "light"));
  for (const [tab, id] of [["members", "members"], ["billing", "billing"], ["integrations", "integrations"], ["profile", "profile"]]) {
    await p.goto(`${BASE}/app/${s.wid}/settings?tab=${tab}`, { waitUntil: "networkidle" });
    await sleep(1500);
    await shot(p, id);
  }
};

SECTIONS.phone = async ({ browser, s }) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], storageState: s.storage });
  await ctx.addInitScript(() => localStorage.setItem("pdftek-tour", "done"));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/app/${s.wid}`, { waitUntil: "networkidle" });
  await sleep(2500);
  await shot(p, "phone-home");
  await p.click(".wb-bnav .big");
  await sleep(3500);
  await shot(p, "phone-scan");
  await p.keyboard.press("Escape");
  await p.goto(`${BASE}/app/${s.wid}?doc=${s.docs["Northwind service agreement.pdf"]}`, { waitUntil: "networkidle" });
  await sleep(2500);
  await p.click(".wb-phbar .wb-btn:has-text('Tools')");
  await sleep(700);
  await shot(p, "phone-tools");
  await p.mouse.click(200, 60);
  await sleep(400);
  await p.click(".wb-phbar .wb-btn:has-text('Ask AI')");
  await sleep(2500);
  await p.click(".wb-sum .btn").catch(() => {});
  await sleep(4000);
  await shot(p, "phone-ai");
  await ctx.close();
};

/* --------------------------------------------------------------------------------- run */
(async () => {
  const cam = path.join(OUT, "camera.y4m");
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(fs.existsSync(cam) ? [`--use-file-for-fake-video-capture=${cam}`] : [])],
  });
  const s = await setup(browser);
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (ONLY && !ONLY.has(name)) continue;
    log(`section ${name}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 / 3, storageState: s.storage, acceptDownloads: true, permissions: ["camera"] });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("pdftek-tour", "done");
      } catch {}
    });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    try {
      await fn({ browser, s, page, ctx });
    } catch (e) {
      console.error(`  FAILED in ${name}:`, e.message.split("\n")[0]);
      await page.screenshot({ path: path.join(OUT, `_fail-${name}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
  await browser.close();
})();
