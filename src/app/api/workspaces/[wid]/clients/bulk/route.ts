import { z } from "zod";
import { all } from "@/lib/db";
import { badRequest, body, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { bulkRequest } from "@/lib/clients";
import { RequestSpec } from "@/lib/client-schemas";

type P = { params: Promise<{ wid: string }> };

/** One checklist to many clients: the selected ones, or everyone with a tag. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await firmCtx(wid);
  const input = await body(req, z.object({ clientIds: z.array(z.string()).max(500).optional(), tag: z.string().max(40).optional(), spec: RequestSpec }));
  let ids = input.clientIds ?? [];
  if (input.tag) {
    const tag = input.tag.toLowerCase();
    ids = all<{ id: string; tags: string }>("SELECT id, tags FROM clients WHERE workspace_id = ? AND archived_at IS NULL", wid)
      .filter((c) => (JSON.parse(c.tags) as string[]).some((t) => t.toLowerCase() === tag))
      .map((c) => c.id);
  }
  if (!ids.length) throw badRequest("No clients match. Choose clients or a tag that's in use.");
  return json(await bulkRequest(ctx, ids, input.spec));
});
