import "server-only";
import { get, run } from "./db";
import { HttpError, badRequest } from "./http";
import { tierOf } from "./billing";
import { PRO_CLIENTS } from "./plans";
import { appUrl } from "./mail";
import type { Ctx } from "./auth";

/**
 * Firms (tax preparers, accountants, bookkeepers) use Clients to manage the people they collect
 * documents from. It comes with Pro (up to PRO_CLIENTS clients) and Team (no limit). The firm's
 * clients never pay and never need a pdftek plan.
 */

export type FirmRow = {
  id: string;
  name: string;
  firm_slug: string | null;
  firm_name: string | null;
  brand_color: string | null;
  brand_logo_key: string | null;
  retention_years: number | null;
};

export function firmOf(workspaceId: string): FirmRow {
  return get<FirmRow>("SELECT id, name, firm_slug, firm_name, brand_color, brand_logo_key, retention_years FROM workspaces WHERE id = ?", workspaceId)!;
}

export function firmBySlug(slug: string): FirmRow | undefined {
  return get<FirmRow>("SELECT id, name, firm_slug, firm_name, brand_color, brand_logo_key, retention_years FROM workspaces WHERE firm_slug = ?", slug.toLowerCase());
}

export const firmDisplayName = (f: FirmRow) => f.firm_name?.trim() || f.name;

/** Clients is part of Pro and Team (a running trial counts as Pro). */
export function requireFirmPlan(ctx: Ctx) {
  const tier = tierOf(ctx);
  if (tier === "pro" || tier === "team" || tier === "admin") return tier;
  throw new HttpError(402, `Clients (client accounts, document requests and the client portal) comes with pdftek Pro (up to ${PRO_CLIENTS} clients) or Team (unlimited clients).`, "membership_required");
}

export function clientLimit(ctx: Ctx): number {
  const tier = requireFirmPlan(ctx);
  return tier === "pro" ? PRO_CLIENTS : Infinity;
}

export function activeClientCount(workspaceId: string) {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM clients WHERE workspace_id = ? AND archived_at IS NULL", workspaceId)!.n;
}

/** Before adding `adding` clients. */
export function assertClientRoom(ctx: Ctx, adding = 1) {
  const limit = clientLimit(ctx);
  const have = activeClientCount(ctx.workspace.id);
  if (have + adding <= limit) return;
  throw new HttpError(
    402,
    adding > 1 && have < limit
      ? `Pro includes up to ${PRO_CLIENTS} clients. You have ${have}, so ${limit - have} more can be added. Upgrade to Team for unlimited clients.`
      : `Pro includes up to ${PRO_CLIENTS} active clients. Archive clients you no longer work with, or upgrade to Team for unlimited clients.`,
    "seat_limit",
  );
}

// ---------- portal address ----------

/** Names that can't be a firm address (they're pdftek's own, or could be mistaken for it). */
const RESERVED = new Set([
  "www", "app", "api", "admin", "mail", "email", "smtp", "help", "support", "docs", "blog", "status", "portal", "login", "signin", "signup", "account",
  "billing", "pay", "payments", "secure", "static", "cdn", "assets", "dev", "staging", "test", "demo", "pdftek", "dashboard", "auth", "sso", "ftp", "m",
]);

export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug)) return "Use 3–30 lowercase letters, numbers or hyphens, starting and ending with a letter or number.";
  if (RESERVED.has(slug)) return "That address is reserved. Try another.";
  return null;
}

/** The firm's address, created from its name the first time it's needed. */
export function ensureSlug(workspaceId: string): string {
  const f = firmOf(workspaceId);
  if (f.firm_slug) return f.firm_slug;
  let base = slugify(firmDisplayName(f)) || "firm";
  if (base.length < 3 || RESERVED.has(base)) base = `${base}-firm`.replace(/^-/, "");
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base.slice(0, 26)}-${i + 1}` : base;
    if (!get("SELECT 1 FROM workspaces WHERE firm_slug = ?", s)) {
      run("UPDATE workspaces SET firm_slug = ? WHERE id = ?", s, workspaceId);
      return s;
    }
  }
  throw badRequest("Couldn't create a portal address. Choose one in Firm settings.");
}

export function setSlug(workspaceId: string, slug: string) {
  const s = slug.trim().toLowerCase();
  const problem = slugProblem(s);
  if (problem) throw badRequest(problem);
  const taken = get<{ id: string }>("SELECT id FROM workspaces WHERE firm_slug = ?", s);
  if (taken && taken.id !== workspaceId) throw badRequest("That address is taken. Try another.");
  run("UPDATE workspaces SET firm_slug = ? WHERE id = ?", s, workspaceId);
}

/** The pdftek domain firms get addresses under (pdftek.com → sark.pdftek.com). */
export function baseHost(): string | null {
  try {
    return new URL(process.env.APP_URL || "").hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Where a firm's clients sign in. With FIRM_SUBDOMAINS=1 (once the wildcard DNS record and
 * certificate are in place) that's https://slug.pdftek.com; until then https://pdftek.com/portal/slug.
 */
export function portalUrl(slug: string, path = "") {
  const host = baseHost();
  if (process.env.FIRM_SUBDOMAINS === "1" && host) {
    const app = new URL(appUrl());
    return `${app.protocol}//${slug}.${host}${app.port ? `:${app.port}` : ""}${path || "/"}`;
  }
  return appUrl(`/portal/${slug}${path}`);
}

export function portalHost(slug: string) {
  const host = baseHost();
  return host ? `${slug}.${host}` : null;
}

export function brand(f: FirmRow) {
  return {
    name: firmDisplayName(f),
    slug: f.firm_slug,
    color: f.brand_color && /^#[0-9a-f]{6}$/i.test(f.brand_color) ? f.brand_color : "#b84a0b",
    logo: f.brand_logo_key ? `/api/portal/${f.firm_slug}/logo` : null,
  };
}
