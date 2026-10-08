/**
 * Prices and limits, shared by the server (enforcement, Stripe Checkout) and the UI (pricing page,
 * paywall). Change a price here and it changes everywhere.
 */

export const FREE_LIMITS = {
  guest: { tasksPerDay: 5, maxFileMb: 20, maxFiles: 5 },
  free: { tasksPerDay: 10, maxFileMb: 20, maxFiles: 5 },
} as const;
export const PAID_LIMITS = { tasksPerDay: 2000, maxFileMb: 100, maxFiles: 50 } as const; // fair use

/** A task beyond the free daily limit costs this many credits. */
export const EXTRA_TASK_CREDITS = 2;
/** Minimum balance to start an AI request (the real cost is charged after it finishes). */
export const AI_MIN_CREDITS = 5;

export type ProductId = "pass" | "pro_month" | "pro_year" | "team_month" | "credits_250" | "credits_900" | "credits_3000";
export type Product = {
  name: string;
  description: string;
  cents: number;
  mode: "payment" | "subscription";
  interval?: "month" | "year";
  plan?: "pro" | "business";
  credits?: number;
  passHours?: number;
};

export const PRODUCTS: Record<ProductId, Product> = {
  pass: {
    name: "pdftek Day Pass",
    description: "24 hours of unlimited tasks, editing, read aloud and e-signatures, plus 50 AI credits.",
    cents: 199,
    mode: "payment",
    passHours: 24,
    credits: 50,
  },
  pro_month: { name: "pdftek Pro", description: "Unlimited tasks, editing, read aloud, e-signatures and 400 AI credits every month.", cents: 599, mode: "subscription", interval: "month", plan: "pro" },
  pro_year: { name: "pdftek Pro (yearly)", description: "Everything in Pro, billed yearly: 4 months free.", cents: 4799, mode: "subscription", interval: "year", plan: "pro" },
  team_month: { name: "pdftek Team", description: "Pro for up to 5 people, with automations, document requests and 1,500 AI credits every month.", cents: 1499, mode: "subscription", interval: "month", plan: "business" },
  credits_250: { name: "250 AI credits", description: "Pay as you go. Credits never expire.", cents: 299, mode: "payment", credits: 250 },
  credits_900: { name: "900 AI credits", description: "Pay as you go. Credits never expire.", cents: 899, mode: "payment", credits: 900 },
  credits_3000: { name: "3,000 AI credits", description: "Pay as you go. Credits never expire.", cents: 2499, mode: "payment", credits: 3000 },
};


export const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export type Entitlements = {
  tier: "guest" | "free" | "pass" | "pro" | "team" | "admin";
  membership: boolean;
  tasksToday: number;
  taskLimit: number | null;
  maxFileMb: number;
  maxFiles: number;
  passUntil: number | null;
  credits: number;
  allowance: number;
  allowanceExpiresAt: number | null;
  paymentsEnabled: boolean;
};

export const PRICING_FAQ: [string, string][] = [
  ["Do I need an account?", "No. Every free tool works without signing up, and you can buy a Day Pass or credits without an account too. A free account doubles your daily free tasks and keeps your files."],
  [
    "What counts as a task?",
    "One conversion or one tool run: converting a file, merging, splitting, compressing, protecting, unlocking, OCR, and so on. Opening and reading PDFs is free and unlimited.",
  ],
  [
    "What are credits?",
    `Credits pay for AI (questions, summaries, extraction, comparisons) and for tasks beyond the free daily limit (${EXTRA_TASK_CREDITS} credits each). AI is charged on what each request actually costs, so short questions cost a few credits and long documents a little more. Purchased credits never expire.`,
  ],
  ["What does the Day Pass include?", `24 hours of everything in Pro: unlimited tasks, files up to ${PAID_LIMITS.maxFileMb} MB, editing, read aloud and e-signatures, plus 50 AI credits. It doesn't renew.`],
  ["Can I cancel Pro anytime?", "Yes. Cancel from Settings → Billing in one click; Pro stays active until the end of the period you paid for."],
  ["Is my data safe?", "Files are encrypted in transit, never sold or used to train AI, and files from visitors without an account are deleted after 24 hours."],
];
