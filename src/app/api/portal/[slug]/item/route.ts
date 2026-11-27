import { z } from "zod";
import { body, clientIp, json, route } from "@/lib/http";
import { clientRequest, requireClient } from "@/lib/client-portal";
import { markNotApplicable } from "@/lib/requests";

type P = { params: Promise<{ slug: string }> };

/** "Doesn't apply to me this year" (reason), or undo it (null). */
export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { client } = await requireClient(slug);
  const input = await body(req, z.object({ requestId: z.string(), itemId: z.string(), notApplicable: z.string().max(300).nullable() }));
  const r = clientRequest(client, input.requestId);
  return json({ item: markNotApplicable(r, input.itemId, input.notApplicable, clientIp(req)) });
});
