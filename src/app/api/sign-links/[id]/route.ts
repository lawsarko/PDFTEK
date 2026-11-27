import { z } from "zod";
import { get, run, update } from "@/lib/db";
import { body, json, notFound, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { linkDTO, type LinkRow } from "@/lib/esign";

type P = { params: Promise<{ id: string }> };

async function access(linkId: string) {
  const l = get<LinkRow>("SELECT * FROM sign_links WHERE id = ?", linkId);
  if (!l) throw notFound("Signing link not found.");
  await requireMember(l.workspace_id);
  return l;
}

const Input = z.object({ active: z.boolean().optional(), title: z.string().trim().min(1).max(200).optional() });

/** Turns a signing link on or off, or renames it. */
export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const l = await access(id);
  const input = await body(req, Input);
  const patch: Record<string, unknown> = {};
  if (input.active !== undefined) patch.active = input.active ? 1 : 0;
  if (input.title) patch.title = input.title;
  if (Object.keys(patch).length) update("sign_links", l.id, patch);
  return json({ link: linkDTO(get<LinkRow>("SELECT * FROM sign_links WHERE id = ?", l.id)!) });
});

/** Deletes a link. Envelopes already signed through it are kept. */
export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const l = await access(id);
  run("DELETE FROM sign_links WHERE id = ?", l.id);
  return json({ ok: true });
});
