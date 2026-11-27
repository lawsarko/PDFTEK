import { json, route } from "@/lib/http";
import { signOut } from "@/lib/client-portal";

type P = { params: Promise<{ slug: string }> };

export const POST = route<P>(async (_req, { params }) => {
  await signOut((await params).slug);
  return json({ ok: true });
});
