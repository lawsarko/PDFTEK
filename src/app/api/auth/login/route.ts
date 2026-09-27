import { z } from "zod";
import { get } from "@/lib/db";
import { body, clientIp, json, route, HttpError } from "@/lib/http";
import { createSession, firstWorkspaceFor, rateLimit, verifyPassword } from "@/lib/auth";

const Input = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const input = await body(req, Input);
  rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000);
  rateLimit(`login:${input.email}`, 10, 15 * 60_000);
  const user = get<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", input.email);
  if (!user || !verifyPassword(input.password, user.password_hash)) throw new HttpError(401, "Email or password is incorrect.");
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ ok: true, workspaceId: firstWorkspaceFor(user.id) ?? null });
});
