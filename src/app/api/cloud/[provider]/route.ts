import { badRequest, json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { connections, disconnect, isProvider } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

/** Disconnects a cloud account from pdftek (files already imported stay in the library). */
export const DELETE = route<P>(async (_req, { params }) => {
  const { provider } = await params;
  if (!isProvider(provider)) throw badRequest("Unknown service.");
  const user = await requireUser();
  disconnect(user.id, provider);
  return json({ connections: connections(user.id) });
});
