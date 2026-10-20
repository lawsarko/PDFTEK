import { cookies } from "next/headers";
import { HttpError, clientIp, json, route } from "@/lib/http";
import { hasSession, loadByToken, sessionCookie, submit } from "@/lib/requests";

type P = { params: Promise<{ token: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { token } = await params;
  const r = loadByToken(token);
  if (!hasSession(r, (await cookies()).get(sessionCookie(token))?.value)) throw new HttpError(401, "Please verify with your code first.", "verify_required");
  await submit(r, clientIp(req));
  return json({ ok: true });
});
