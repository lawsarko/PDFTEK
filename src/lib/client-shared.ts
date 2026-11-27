/** Shared by the firm dashboard, the client portal and the server. */

export const STAGES = [
  { key: "not_started", label: "Not started", tone: "muted" },
  { key: "waiting", label: "Waiting on client", tone: "warn" },
  { key: "docs_in", label: "Documents in", tone: "info" },
  { key: "preparing", label: "Preparing", tone: "info" },
  { key: "review", label: "In review", tone: "info" },
  { key: "ready_to_sign", label: "Ready to sign", tone: "warn" },
  { key: "filed", label: "Completed", tone: "good" },
] as const;
export type Stage = (typeof STAGES)[number]["key"];
export const STAGE_KEYS = STAGES.map((s) => s.key) as [Stage, ...Stage[]];
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;

export const CLIENT_KINDS = [
  { key: "individual", label: "Individual" },
  { key: "couple", label: "Married couple" },
  { key: "business", label: "Business" },
] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number]["key"];

/** Services a firm tracks per client and year. */
export const SERVICES = ["Tax return", "Bookkeeping", "Payroll", "Sales tax", "Advisory"] as const;

/**
 * The tax year a firm is working on: from November, next season's returns (this year's income);
 * before that, last year's returns (extensions run to mid-October).
 */
export function seasonYear(d = new Date()) {
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}

/** US federal filing dates for a tax year (weekends roll to Monday). */
export function deadlines(taxYear: number) {
  const y = taxYear + 1;
  const roll = (m: number, day: number) => {
    const d = new Date(Date.UTC(y, m, day));
    const wd = d.getUTCDay();
    if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
    if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  return [
    { date: roll(0, 31), label: "W-2s and 1099-NEC due to recipients" },
    { date: roll(2, 15), label: "S-corp and partnership returns (1120-S, 1065)" },
    { date: roll(3, 15), label: "Individual and C-corp returns (1040, 1120), and Q1 estimates" },
    { date: roll(8, 15), label: "Extended S-corp and partnership returns" },
    { date: roll(9, 15), label: "Extended individual returns" },
  ];
}

/** Form types the AI check recognises, with the item labels they usually satisfy. */
export const TAX_FORMS = [
  "W-2", "1099-NEC", "1099-MISC", "1099-INT", "1099-DIV", "1099-B", "1099-R", "1099-G", "1099-K", "1099-SA", "SSA-1099", "1098", "1098-T", "1098-E",
  "1095-A", "K-1", "1040", "Bank statement", "Credit card statement", "Brokerage statement", "Invoice", "Receipt", "Photo ID", "Property tax bill",
  "Charitable receipt", "Childcare statement", "Other",
] as const;
