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
