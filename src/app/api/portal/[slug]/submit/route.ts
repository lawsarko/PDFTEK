import { z } from "zod";
import { body, clientIp, json, route } from "@/lib/http";
import { clientRequest, requireClient } from "@/lib/client-portal";
import { submit } from "@/lib/requests";

type P = { params: Promise<{ slug: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { client } = await requireClient(slug);
  const { requestId } = await body(req, z.object({ requestId: z.string() }));
  await submit(clientRequest(client, requestId), clientIp(req));
  return json({ ok: true });
});
