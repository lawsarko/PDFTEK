/**
 * Ready-made checklists for document requests: the paperwork people most often chase by email.
 * Shared by the request form (to fill the checklist) and the marketing page (to list them).
 */

export type Accept = "any" | "pdf" | "image" | "office";
export type TemplateItem = { label: string; note?: string; required?: boolean; accept?: Accept };
export type RequestTemplate = { key: string; name: string; title: string; message: string; items: TemplateItem[] };

export const ACCEPT_LABEL: Record<Accept, string> = {
  any: "Any file",
  pdf: "PDF only",
  image: "Photo or scan",
  office: "Word, Excel or PDF",
};

/** File extensions each choice allows (checked on upload). */
export const ACCEPT_EXT: Record<Accept, string[] | null> = {
  any: null,
  pdf: ["pdf"],
  image: ["jpg", "jpeg", "png", "tif", "tiff", "heic", "webp", "pdf"],
  office: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "odt", "ods", "rtf", "txt"],
};

export const REQUEST_TEMPLATES: RequestTemplate[] = [
  {
    key: "tax",
    name: "Tax documents",
    title: "Tax documents",
    message: "Please upload your documents for this year's tax return.",
    items: [
      { label: "W-2 or 1099 forms", note: "All employers and clients for the year" },
      { label: "Last year's tax return", accept: "pdf" },
      { label: "Mortgage interest statement (1098)", required: false },
      { label: "Receipts for deductions", note: "Charity, medical, education", required: false },
    ],
  },
  {
    key: "rental",
    name: "Rental application",
    title: "Rental application documents",
    message: "Please upload the documents below to complete your rental application.",
    items: [
      { label: "Photo ID", note: "Driver's license or passport, front and back", accept: "image" },
      { label: "Proof of income", note: "Last 2 pay stubs or an offer letter" },
      { label: "Last 2 bank statements", accept: "pdf" },
      { label: "Reference letter", required: false },
    ],
  },
  {
    key: "kyc",
    name: "ID verification",
    title: "Identity verification",
    message: "To verify your identity, please upload the documents below.",
    items: [
      { label: "Government-issued photo ID", note: "Front and back", accept: "image" },
      { label: "Proof of address", note: "Utility bill or bank statement from the last 3 months" },
    ],
  },
  {
    key: "loan",
    name: "Loan or mortgage",
    title: "Loan application documents",
    message: "Please upload the documents below so we can review your application.",
    items: [
      { label: "Photo ID", accept: "image" },
      { label: "Last 2 pay stubs" },
      { label: "Last 2 years of tax returns", accept: "pdf" },
      { label: "Last 3 bank statements", accept: "pdf" },
      { label: "Proof of other assets", required: false },
    ],
  },
  {
    key: "client",
    name: "New client onboarding",
    title: "Onboarding documents",
    message: "Welcome aboard! Please upload the documents below so we can get started.",
    items: [
      { label: "Signed engagement letter", accept: "pdf" },
      { label: "W-9", accept: "pdf" },
      { label: "Certificate of insurance", required: false },
    ],
  },
  {
    key: "employee",
    name: "Employee onboarding",
    title: "New hire paperwork",
    message: "Welcome to the team! Please upload the documents below before your first day.",
    items: [
      { label: "Form I-9 identity documents", note: "Passport, or driver's license and Social Security card", accept: "image" },
      { label: "Signed W-4", accept: "pdf" },
      { label: "Direct deposit form or voided check" },
      { label: "Signed offer letter", accept: "pdf" },
    ],
  },
  {
    key: "claim",
    name: "Insurance claim",
    title: "Claim documents",
    message: "Please upload the documents below so we can process your claim.",
    items: [
      { label: "Photos of the damage", accept: "image" },
      { label: "Police or incident report", required: false },
      { label: "Repair estimates or receipts" },
    ],
  },
];

/** Checklists for tax and accounting firms (Clients → New request). */
export const FIRM_TEMPLATES: RequestTemplate[] = [
  {
    key: "1040",
    name: "Individual tax return (1040)",
    title: "Tax documents",
    message: "Please upload your documents for this year's tax return. If something doesn't apply to you this year, mark it that way.",
    items: [
      { label: "W-2s from every employer", note: "One for each job you had during the year" },
      { label: "1099s (interest, dividends, brokerage)", note: "1099-INT, 1099-DIV, 1099-B or a composite statement", required: false },
      { label: "1099-NEC / 1099-MISC / 1099-K", note: "Freelance, contract or platform income", required: false },
      { label: "1099-R / SSA-1099", note: "Retirement distributions and Social Security", required: false },
      { label: "Form 1098 mortgage interest", required: false },
      { label: "Property tax bills", required: false },
      { label: "Charitable donation receipts", required: false },
      { label: "1098-T tuition / 1098-E student loan interest", required: false },
      { label: "1095-A health insurance marketplace statement", required: false },
      { label: "Estimated tax payments made", note: "Dates and amounts, federal and state", required: false },
      { label: "Photo ID (taxpayer and spouse)", note: "Driver's license or passport, front and back", accept: "image", required: false },
    ],
  },
  {
    key: "schedule_c",
    name: "Self-employed (Schedule C)",
    title: "Self-employment documents",
    message: "Please upload your business records for the year.",
    items: [
      { label: "1099-NEC / 1099-K received" },
      { label: "Income records", note: "Invoices, sales reports or a profit and loss statement" },
      { label: "Business expense records", note: "Receipts, statements or a spreadsheet by category" },
      { label: "Business bank and credit card statements", note: "All 12 months", accept: "pdf" },
      { label: "Vehicle mileage log", required: false },
      { label: "Home office details", note: "Square footage of the office and the home", required: false },
      { label: "Health insurance premiums paid", required: false },
    ],
  },
  {
    key: "rental",
    name: "Rental property (Schedule E)",
    title: "Rental property documents",
    message: "Please upload the records for each rental property.",
    items: [
      { label: "Rent received", note: "Rent roll or summary for each property" },
      { label: "Rental expenses", note: "Repairs, management fees, utilities, HOA, supplies" },
      { label: "Form 1098 mortgage interest for each property", required: false },
      { label: "Property tax bills", required: false },
      { label: "Insurance declarations", required: false },
      { label: "Purchase or improvement documents", note: "Closing statement or large improvements this year", required: false },
    ],
  },
  {
    key: "business",
    name: "Business return (1120-S / 1065)",
    title: "Business tax documents",
    message: "Please upload the business records for this year's return.",
    items: [
      { label: "Year-end profit and loss and balance sheet" },
      { label: "Bank statements, all accounts, December", accept: "pdf" },
      { label: "Loan statements (year-end balances)", required: false },
      { label: "Fixed asset purchases and sales", required: false },
      { label: "Payroll reports (941s, W-3, state)", required: false },
      { label: "1099s issued to contractors", required: false },
      { label: "Prior-year return (new clients)", accept: "pdf", required: false },
    ],
  },
  {
    key: "onboarding_tax",
    name: "New client onboarding",
    title: "Welcome: getting started",
    message: "Welcome! Please upload the documents below so we can get started.",
    items: [
      { label: "Last 2 years of tax returns", accept: "pdf" },
      { label: "Photo ID (taxpayer and spouse)", accept: "image" },
      { label: "Signed engagement letter", accept: "pdf" },
      { label: "IRS or state notices received", required: false },
    ],
  },
  {
    key: "bookkeeping",
    name: "Monthly bookkeeping",
    title: "Monthly statements",
    message: "Please upload this month's statements.",
    items: [
      { label: "Bank statements (all accounts)", accept: "pdf" },
      { label: "Credit card statements", accept: "pdf", required: false },
      { label: "Receipts and bills", required: false },
      { label: "Payroll reports", required: false },
    ],
  },
];
