import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireClient } from "@/lib/client-portal";
import { postClientMessage } from "@/lib/clients";
import { rateLimit } from "@/lib/auth";

type P = { params: Promise<{ slug: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { client } = await requireClient(slug);
  rateLimit(`portal-msg:${client.id}`, 30, 3600_000);
  const { body: text } = await body(req, z.object({ body: z.string().min(1).max(5000) }));
  postClientMessage(client, text);
  return json({ ok: true });
});
