import { z } from "zod";
import { cookies } from "next/headers";
import { body, clientIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { loadByToken, sendOtp, sessionCookie, verifyCode } from "@/lib/requests";

type P = { params: Promise<{ token: string }> };

const Input = z.union([z.object({ action: z.literal("send") }), z.object({ code: z.string().trim().min(4).max(20) })]);

export const POST = route<P>(async (req, { params }) => {
  const { token } = await params;
  const ip = clientIp(req);
  rateLimit(`request-verify:${ip}`, 30, 3600_000);
  const r = loadByToken(token);
  const input = await body(req, Input);
  if ("action" in input) {
    rateLimit(`request-otp:${r.id}`, 6, 3600_000);
    await sendOtp(r, ip);
    return json({ sent: true });
  }
  const session = verifyCode(r, input.code, ip);
  (await cookies()).set(sessionCookie(token), session.raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return json({ ok: true });
});
