import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { confirmPay, payCheckout, requireClient } from "@/lib/client-portal";

type P = { params: Promise<{ slug: string }> };

/** Start paying an invoice that unlocks a document, or confirm on return from Stripe. */
export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { client } = await requireClient(slug);
  const input = await body(req, z.object({ fileId: z.string(), session: z.string().optional() }));
  if (input.session) return json({ paid: await confirmPay(client, input.fileId, input.session) });
  return json({ url: await payCheckout(client, slug, input.fileId) });
});
