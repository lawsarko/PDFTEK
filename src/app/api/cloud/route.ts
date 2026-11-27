import { json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { connections } from "@/lib/cloud";

/** The signed-in person's cloud storage connections (and which services this server offers). */
export const GET = route(async () => {
  const user = await requireUser();
  return json({ connections: connections(user.id) });
});
