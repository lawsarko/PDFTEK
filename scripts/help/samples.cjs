// Makes the sample documents shown in the Help Center screenshots (fictional companies and people).
// Usage: node scripts/help/samples.cjs <out-dir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const css = `body{font-family:Georgia,serif;color:#222;margin:0}h1{font-family:Helvetica,Arial,sans-serif}
.pg{padding:56px 64px;page-break-after:always}.pg:last-child{page-break-after:auto}
.band{background:#1b3a6b;color:#fff;margin:-56px -64px 28px;padding:36px 64px;font-family:Helvetica,Arial,sans-serif}
.band h1{margin:0;font-size:30px}.band p{margin:6px 0 0;opacity:.85}
h2{font-family:Helvetica,Arial,sans-serif;color:#1b3a6b;font-size:17px;margin:22px 0 8px}
p,li{font-size:12.5px;line-height:1.6}table{width:100%;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:12px}
th,td{border:1px solid #c9d1dc;padding:6px 8px;text-align:left}th{background:#e8eef7}td.n{text-align:right}
.sig{display:flex;gap:40px;margin-top:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px;font-family:Helvetica,Arial,sans-serif}`;

const DOCS = {
  "Northwind service agreement.pdf": `
<div class="pg"><div class="band"><h1>Master Service Agreement</h1><p>Northwind Supplies Inc. · Contract No. NW-2026-114</p></div>
<p>This Master Service Agreement (the "Agreement") is made on <b>March 1, 2026</b> between <b>Northwind Supplies Inc.</b>, 400 Harbor Way, Seattle, WA ("Supplier") and <b>Morgan &amp; Co. LLC</b>, 18 Elm Street, Portland, OR ("Client").</p>
<h2>1. Services</h2><p>Supplier will deliver office equipment and maintenance services at the locations listed in Schedule A. Deliveries are completed within ten business days of each purchase order.</p>
<h2>2. Term and renewal</h2><p>The Agreement runs for <b>12 months</b> from the effective date and renews automatically for further 12-month terms unless either party gives <b>60 days' written notice</b> before the end of the current term.</p>
<h2>3. Fees and payment</h2><table><tr><th>Item</th><th>Quantity</th><th class="n">Amount</th></tr><tr><td>Laptops</td><td>12</td><td class="n">$14,400.00</td></tr><tr><td>Maintenance plan (annual)</td><td>1</td><td class="n">$2,350.00</td></tr><tr><td><b>Total</b></td><td></td><td class="n"><b>$16,750.00</b></td></tr></table>
<p>Invoices are payable within <b>30 days</b>. Late payments accrue interest at 1% per month.</p></div>
<div class="pg"><h2>4. Limitation of liability</h2><p>Each party's total liability under this Agreement is capped at the fees paid in the <b>6 months</b> before the claim. Neither party is liable for indirect or consequential losses.</p>
<h2>5. Confidentiality</h2><p>Each party keeps the other's confidential information secret for three years after the Agreement ends.</p>
<h2>6. Termination</h2><p>Either party may terminate for material breach not cured within 30 days of written notice. Client may terminate for convenience on 90 days' notice.</p>
<h2>7. Governing law</h2><p>This Agreement is governed by the laws of the State of Washington.</p></div>
<div class="pg"><h2>Schedule A: Locations</h2><table><tr><th>Site</th><th>Address</th><th>Contact</th></tr><tr><td>Head office</td><td>18 Elm Street, Portland, OR</td><td>Jamie Rivera</td></tr><tr><td>Warehouse</td><td>220 Dock Road, Tacoma, WA</td><td>Priya Shah</td></tr></table>
<div class="sig"><div>For Northwind Supplies Inc.<br><br>Name: Dana Whitfield, COO</div><div>For Morgan &amp; Co. LLC<br><br>Name: Alex Morgan, Managing Partner</div></div></div>`,
  "Bank statement March 2026.pdf": `
<div class="pg"><div class="band" style="background:#0f5132"><h1>Cascade Community Bank</h1><p>Business Checking · Statement period Mar 1 – Mar 31, 2026</p></div>
<p><b>Morgan &amp; Co. LLC</b><br>Account ending 4821</p>
<table><tr><th>Date</th><th>Description</th><th class="n">Withdrawals</th><th class="n">Deposits</th><th class="n">Balance</th></tr>
<tr><td>03/01</td><td>Opening balance</td><td></td><td></td><td class="n">24,310.55</td></tr>
<tr><td>03/03</td><td>Client payment – Fernwood Dental</td><td></td><td class="n">4,800.00</td><td class="n">29,110.55</td></tr>
<tr><td>03/05</td><td>Northwind Supplies – INV 2041</td><td class="n">16,750.00</td><td></td><td class="n">12,360.55</td></tr>
<tr><td>03/09</td><td>Payroll – March 1st half</td><td class="n">6,920.40</td><td></td><td class="n">5,440.15</td></tr>
<tr><td>03/14</td><td>Client payment – Harbor Realty</td><td></td><td class="n">7,250.00</td><td class="n">12,690.15</td></tr>
<tr><td>03/18</td><td>Office rent – Elm Street</td><td class="n">3,100.00</td><td></td><td class="n">9,590.15</td></tr>
<tr><td>03/22</td><td>Software subscriptions</td><td class="n">412.99</td><td></td><td class="n">9,177.16</td></tr>
<tr><td>03/25</td><td>Client payment – Lumen Studio</td><td></td><td class="n">3,600.00</td><td class="n">12,777.16</td></tr>
<tr><td>03/31</td><td>Monthly service fee</td><td class="n">15.00</td><td></td><td class="n">12,762.16</td></tr>
<tr><td>03/31</td><td>Closing balance</td><td></td><td></td><td class="n"><b>12,762.16</b></td></tr></table></div>`,
  "Invoice INV-2041.pdf": `
<div class="pg"><div class="band" style="background:#7a2e0e"><h1>Invoice INV-2041</h1><p>Northwind Supplies Inc. · 400 Harbor Way, Seattle, WA</p></div>
<p><b>Bill to:</b> Morgan &amp; Co. LLC, 18 Elm Street, Portland, OR<br><b>Date:</b> March 2, 2026 · <b>Due:</b> April 1, 2026</p>
<table><tr><th>Description</th><th>Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr>
<tr><td>Laptop, 14" business model</td><td>12</td><td class="n">1,200.00</td><td class="n">14,400.00</td></tr>
<tr><td>Maintenance plan (annual)</td><td>1</td><td class="n">2,350.00</td><td class="n">2,350.00</td></tr>
<tr><td colspan="3"><b>Total due</b></td><td class="n"><b>$16,750.00</b></td></tr></table>
<p>Pay by bank transfer to account 0098-221-4. Thank you for your business.</p></div>`,
  "Q1 board report.pdf": `
<div class="pg"><div class="band" style="background:#3b2f6b"><h1>Q1 2026 Board Report</h1><p>Morgan &amp; Co. LLC · Prepared April 4, 2026</p></div>
<h2>Highlights</h2><ul><li>Revenue grew 18% to $412,000.</li><li>Three new enterprise clients signed.</li><li>Operating margin improved to 22%.</li></ul>
<h2>Revenue by quarter</h2><table><tr><th>Quarter</th><th class="n">Revenue</th><th class="n">Margin</th></tr><tr><td>Q2 2025</td><td class="n">$318,000</td><td class="n">17%</td></tr><tr><td>Q3 2025</td><td class="n">$341,000</td><td class="n">19%</td></tr><tr><td>Q4 2025</td><td class="n">$349,000</td><td class="n">20%</td></tr><tr><td>Q1 2026</td><td class="n">$412,000</td><td class="n">22%</td></tr></table>
<h2>Priorities for Q2</h2><p>Open the Tacoma office, hire two account managers and renew the Northwind agreement on better terms before the notice deadline.</p></div>`,
  "Mutual NDA - Lumen Studio.pdf": `
<div class="pg"><div class="band" style="background:#334155"><h1>Mutual Non-Disclosure Agreement</h1><p>Morgan &amp; Co. LLC and Lumen Studio Ltd.</p></div>
<p>The parties wish to share confidential information to evaluate a possible partnership. Each party keeps the other's information confidential for <b>two years</b>, uses it only for that purpose, and returns or destroys it on request.</p>
<h2>Exclusions</h2><p>Information that is public, already known, independently developed or lawfully received from a third party is not confidential.</p>
<div class="sig"><div>Morgan &amp; Co. LLC</div><div>Lumen Studio Ltd.</div></div></div>`,
};

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const p = await b.newPage();
  for (const [name, body] of Object.entries(DOCS)) {
    await p.setContent(`<html><head><style>${css}</style></head><body>${body}</body></html>`);
    await p.pdf({ path: path.join(OUT, name), format: "Letter", printBackground: true });
  }
  await b.close();

  // A fillable form (real form fields).
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 712, width: 612, height: 80, color: rgb(0.11, 0.23, 0.42) });
  page.drawText("New Employee Details", { x: 48, y: 748, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Morgan & Co. LLC · HR-01", { x: 48, y: 728, size: 11, font, color: rgb(0.85, 0.9, 1) });
  const form = pdf.getForm();
  const fields = [["Full name", "full_name"], ["Email", "email"], ["Phone", "phone"], ["Street address", "address"], ["City", "city"], ["State", "state"], ["ZIP code", "zip"], ["Date of birth", "dob"], ["Start date", "start_date"], ["Job title", "job_title"]];
  let y = 670;
  for (const [label, id] of fields) {
    page.drawText(label, { x: 48, y: y + 6, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    const f = form.createTextField(id);
    f.addToPage(page, { x: 180, y, width: 360, height: 22, borderColor: rgb(0.6, 0.65, 0.72), borderWidth: 1 });
    y -= 44;
  }
  page.drawText("Signature", { x: 48, y: y + 6, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawLine({ start: { x: 180, y }, end: { x: 540, y }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
  fs.writeFileSync(path.join(OUT, "Employee details form.pdf"), await pdf.save());
  console.log("samples in", OUT);
})();
