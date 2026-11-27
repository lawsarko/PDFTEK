// A stand-in for the AI service while capturing Help Center screenshots: answers each kind of
// request (chat with page citations, extraction, statements, invoices, forms) with realistic,
// fixed content about the sample documents. Never used by the real site.
// Usage: node scripts/help/mock-ai.cjs [port]   then start pdftek with ANTHROPIC_BASE_URL=http://localhost:<port>
const http = require("http");
const PORT = Number(process.argv[2] || 4011);

/** A valid value for a JSON schema (used for anything without a hand-written answer). */
function gen(s) {
  if (!s) return null;
  if (s.enum) return s.enum.find((x) => x !== "") ?? s.enum[0];
  switch (s.type) {
    case "object":
      return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, gen(v)]));
    case "array":
      return [];
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

const FORM_VALUES = {
  full_name: ["Jordan Lee", "profile"],
  email: ["jordan.lee@example.com", "profile"],
  phone: ["(503) 555-0142", "profile"],
  address: ["42 Alder Street", "profile"],
  city: ["Portland", "profile"],
  state: ["OR", "profile"],
  zip: ["97205", "profile"],
  dob: ["1990-06-14", "profile"],
  start_date: ["2026-05-04", "document"],
  job_title: ["Account Manager", "document"],
};
const FORM_LABELS = {
  full_name: ["Full name", "", "text"],
  email: ["Email", "email", "email"],
  phone: ["Phone", "phone", "phone"],
  address: ["Street address", "", "text"],
  city: ["City", "city", "text"],
  state: ["State", "state", "text"],
  zip: ["ZIP code", "postal_code", "text"],
  dob: ["Date of birth", "date_of_birth", "date"],
  start_date: ["Start date", "employment_start_date", "date"],
  job_title: ["Job title", "job_title", "text"],
};

function answer(j, body) {
  const sys = typeof j.system === "string" ? j.system : JSON.stringify(j.system || "");
  const schema = j.output_config?.format?.schema;
  const last = JSON.stringify(j.messages?.[j.messages.length - 1]?.content ?? "");

  if (sys.includes("document assistant")) return { chat: chatAnswer(last) };
  if (sys.includes("You extract structured data")) return { json: extractAnswer(last) };
  if (sys.includes("You transcribe bank")) return { json: STATEMENT };
  if (sys.includes("You transcribe invoices")) return { json: INVOICE };
  if (sys.includes("already has fillable fields")) {
    const ids = Object.keys(FORM_LABELS).filter((id) => body.includes(id));
    return {
      json: {
        summary: { title: "New Employee Details (HR-01)", purpose: "Collects a new hire's contact details and start date for payroll and HR records.", whoFills: "The new employee", submitTo: "Morgan & Co. HR", deadline: "", tips: ["Use the email you check most often.", "Your start date is in your offer letter."] },
        fields: ids.map((id) => ({ id, label: FORM_LABELS[id][0], section: "", help: "", profileKey: FORM_LABELS[id][1], sensitive: id === "dob", required: true, type: FORM_LABELS[id][2], format: id === "dob" || id === "start_date" ? "MM/DD/YYYY" : "" })),
      },
    };
  }
  if (sys.includes("You fill in a form")) {
    // Fields are listed as: f1 | text | "Full name"
    const byLabel = { "full name": "full_name", email: "email", phone: "phone", address: "address", "street address": "address", city: "city", state: "state", "zip code": "zip", "postal code": "zip", "date of birth": "dob", "start date": "start_date", "job title": "job_title" };
    const values = [];
    for (const m of body.matchAll(/(f\d+) \| \w+ \| \\"([^\\]+)\\"/g)) {
      const key = byLabel[m[2].toLowerCase()];
      if (!key) continue;
      const [value, source] = FORM_VALUES[key];
      values.push({ id: m[1], value, source, confidence: key === "start_date" ? 0.7 : 0.96, note: source === "document" ? "From your offer letter" : "" });
    }
    return { json: { values, questions: [] } };
  }
  if (sys.includes("You check documents")) return { json: { formType: "Photo ID", taxYear: 0, issuer: "State of Oregon", taxpayer: "Jordan Lee", summary: "Oregon driver's license for Jordan Lee, valid until 2030", matchesRequest: true, problems: [], amounts: [], suggestedName: "Photo ID – Jordan Lee" } };
  if (schema) return { json: gen(schema) };
  return { text: "The new version changes the renewal notice from 30 to 60 days and lowers the liability cap from 12 to 6 months of fees. Everything else is unchanged." };
}

const P1 = { type: "page_location", document_index: 0, document_title: "Northwind service agreement.pdf" };
function chatAnswer(q) {
  if (/renew in the next|contracts renew|library/i.test(q))
    return [
      { text: "One contract renews soon: " },
      { text: "the Northwind Supplies agreement renews automatically on March 1, 2027 unless notice is given 60 days before", cite: { ...P1, cited_text: "renews automatically for further 12-month terms unless either party gives 60 days' written notice", start_page_number: 1, end_page_number: 2 } },
      { text: ". That makes the notice deadline December 31, 2026. The Lumen Studio NDA has no renewal; it expires two years after signing." },
    ];
  return [
    { text: "**Summary.** This is a 12-month Master Service Agreement between Northwind Supplies Inc. (supplier) and Morgan & Co. LLC (client) for office equipment and maintenance. " },
    { text: "It renews automatically unless either party gives 60 days' written notice", cite: { ...P1, cited_text: "renews automatically for further 12-month terms unless either party gives 60 days' written notice", start_page_number: 1, end_page_number: 2 } },
    { text: ".\n\n**Key facts**\n• Total fees: $16,750, payable within 30 days" },
    { text: "", cite: { ...P1, cited_text: "Invoices are payable within 30 days.", start_page_number: 1, end_page_number: 2 } },
    { text: "\n• Liability is capped at 6 months of fees" },
    { text: "", cite: { ...P1, cited_text: "capped at the fees paid in the 6 months before the claim", start_page_number: 2, end_page_number: 3 } },
    { text: "\n• Client may terminate for convenience on 90 days' notice\n• Governed by Washington law\n\n**Needs action:** diary the notice deadline, December 31, 2026, if you want to renegotiate." },
  ];
}

function extractAnswer(q) {
  if (/Risk flags/.test(q))
    return {
      summary: "Two findings against your playbook: the liability cap is below your 12-month minimum, and the contract renews automatically.",
      tables: [{ title: "Risk flags", columns: ["Severity", "Issue", "Clause", "Why it matters", "Suggested position", "Page"], rows: [["High", "Liability cap below playbook", "4", "Cap is 6 months of fees; your minimum is 12", "Ask for 12 months of fees", "2"], ["Medium", "Automatic renewal", "2", "Renews for 12 months unless notice is given 60 days before", "Diary the notice date or remove auto-renewal", "1"], ["Low", "Late payment interest", "3", "1% per month on late invoices", "Accept", "1"]] }],
    };
  return {
    summary: "A 12-month service agreement for equipment and maintenance worth $16,750, renewing automatically unless 60 days' notice is given.",
    tables: [{ title: "Key terms", columns: ["Term", "Value", "Page"], rows: [["Parties", "Northwind Supplies Inc. (Supplier); Morgan & Co. LLC (Client)", "1"], ["Effective date", "March 1, 2026", "1"], ["Term", "12 months", "1"], ["Renewal", "Automatic 12-month terms unless 60 days' written notice", "1"], ["Fees", "$16,750.00", "1"], ["Payment terms", "Net 30; 1% per month late interest", "1"], ["Liability cap", "Fees paid in the previous 6 months", "2"], ["Termination", "Breach uncured in 30 days; Client for convenience on 90 days' notice", "2"], ["Governing law", "Washington", "2"]] }],
  };
}

const STATEMENT = {
  bank: "Cascade Community Bank", accountHolder: "Morgan & Co. LLC", accountNumber: "****4821", currency: "USD", periodStart: "2026-03-01", periodEnd: "2026-03-31", openingBalance: "24310.55", closingBalance: "12762.16",
  transactions: [
    ["2026-03-03", "Client payment – Fernwood Dental", "4800.00", "29110.55"],
    ["2026-03-05", "Northwind Supplies – INV 2041", "-16750.00", "12360.55"],
    ["2026-03-09", "Payroll – March 1st half", "-6920.40", "5440.15"],
    ["2026-03-14", "Client payment – Harbor Realty", "7250.00", "12690.15"],
    ["2026-03-18", "Office rent – Elm Street", "-3100.00", "9590.15"],
    ["2026-03-22", "Software subscriptions", "-412.99", "9177.16"],
    ["2026-03-25", "Client payment – Lumen Studio", "3600.00", "12777.16"],
    ["2026-03-31", "Monthly service fee", "-15.00", "12762.16"],
  ].map(([date, description, amount, balance]) => ({ date, description, amount, balance, page: 1 })),
};
const INVOICE = { invoices: [] };

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      const a = answer(j, body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "msg_help", type: "message", role: "assistant", content: [], model: j.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1800, output_tokens: 1 } } });
      if (a.chat) {
        a.chat.forEach((seg, i) => {
          ev("content_block_start", { index: i, content_block: { type: "text", text: "", citations: [] } });
          if (seg.cite) ev("content_block_delta", { index: i, delta: { type: "citations_delta", citation: seg.cite } });
          if (seg.text) ev("content_block_delta", { index: i, delta: { type: "text_delta", text: seg.text } });
          ev("content_block_stop", { index: i });
        });
      } else {
        const text = a.json !== undefined ? JSON.stringify(a.json) : a.text;
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
        ev("content_block_stop", { index: 0 });
      }
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 300 } });
      ev("message_stop", {});
      res.end();
    });
  })
  .listen(PORT, () => console.log(`help mock AI on ${PORT}`));
