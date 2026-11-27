import { z } from "zod";
import { run } from "@/lib/db";
import { body, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { brand, ensureSlug, firmOf, portalHost, portalUrl, setSlug } from "@/lib/firm";

type P = { params: Promise<{ wid: string }> };

function view(wid: string) {
  const slug = ensureSlug(wid);
  const f = firmOf(wid);
  return { ...brand(f), firmName: f.firm_name ?? "", workspaceName: f.name, slug, portalUrl: portalUrl(slug), host: portalHost(slug), subdomains: process.env.FIRM_SUBDOMAINS === "1", retentionYears: f.retention_years };
}

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await firmCtx(wid, { write: false });
  return json(view(wid));
});

export const PATCH = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await firmCtx(wid, { role: "admin" });
  const input = await body(
    req,
    z.object({
      firmName: z.string().trim().max(80).optional(),
      slug: z.string().trim().max(30).optional(),
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      retentionYears: z.number().int().min(0).max(30).nullable().optional(),
    }),
  );
  if (input.slug !== undefined) setSlug(wid, input.slug);
  if (input.firmName !== undefined) run("UPDATE workspaces SET firm_name = ? WHERE id = ?", input.firmName || null, wid);
  if (input.brandColor !== undefined) run("UPDATE workspaces SET brand_color = ? WHERE id = ?", input.brandColor.toLowerCase(), wid);
  if (input.retentionYears !== undefined) run("UPDATE workspaces SET retention_years = ? WHERE id = ?", input.retentionYears || null, wid);
  return json(view(wid));
});
