import { json, route } from "@/lib/http";
import { portalHome, requireClient } from "@/lib/client-portal";

type P = { params: Promise<{ slug: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { slug } = await params;
  const { client, firm } = await requireClient(slug);
  return json(portalHome(client, firm));
});
