import { json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { searchWorkspace } from "@/lib/documents";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json({ results: searchWorkspace(wid, q, 40) });
});
