import { cookies } from "next/headers";
import { clientIp, json, route, badRequest } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { hasSession, loadByToken, publicView, sessionCookie, uploadItem } from "@/lib/requests";
import { HttpError } from "@/lib/http";

type P = { params: Promise<{ token: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`public-request:${clientIp(req)}`, 120, 3600_000);
  const r = loadByToken(token);
  const verified = hasSession(r, (await cookies()).get(sessionCookie(token))?.value);
  return json(publicView(r, verified));
});

/** Upload for one checklist item (multipart: itemId + files). */
export const POST = route<P>(async (req, { params }) => {
  const { token } = await params;
  const ip = clientIp(req);
  rateLimit(`public-upload:${ip}`, 60, 3600_000);
  const r = loadByToken(token);
  if (!hasSession(r, (await cookies()).get(sessionCookie(token))?.value)) throw new HttpError(401, "Please verify with your code first.", "verify_required");
  const form = await req.formData();
  const itemId = String(form.get("itemId") ?? "");
  if (!itemId) throw badRequest("Missing checklist item.");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  return json({ item: await uploadItem(r, itemId, files, ip) });
});
