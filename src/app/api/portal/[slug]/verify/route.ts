import { z } from "zod";
import { body, clientIp, json, route } from "@/lib/http";
import { verifyCode } from "@/lib/client-portal";

type P = { params: Promise<{ slug: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { email, code } = await body(req, z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().trim().min(4).max(12) }));
  await verifyCode(slug, email, code, clientIp(req));
  return json({ ok: true });
});
