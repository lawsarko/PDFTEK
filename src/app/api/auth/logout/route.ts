import { json, route } from "@/lib/http";
import { destroySession } from "@/lib/auth";

export const POST = route(async () => {
  await destroySession();
  return json({ ok: true });
});
