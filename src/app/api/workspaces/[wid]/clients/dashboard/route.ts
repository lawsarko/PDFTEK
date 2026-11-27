import { json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { dashboard } from "@/lib/clients";
import { seasonYear } from "@/lib/client-shared";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await firmCtx(wid, { write: false });
  const year = Number(new URL(req.url).searchParams.get("year")) || seasonYear();
  return json(dashboard(ctx, year));
});
