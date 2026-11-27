import { z } from "zod";
import { body, clientIp, json, route } from "@/lib/http";
import { requestLogin } from "@/lib/client-portal";

type P = { params: Promise<{ slug: string }> };

/** Emails a sign-in code and link, if the address belongs to one of the firm's clients. */
export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const { email } = await body(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  await requestLogin(slug, email, clientIp(req));
  return json({ ok: true });
});
