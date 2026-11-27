import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { importClients } from "@/lib/clients";
import { ClientFields } from "@/lib/client-schemas";

type P = { params: Promise<{ wid: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await firmCtx(wid, { role: "admin" });
  const { clients } = await body(req, z.object({ clients: z.array(ClientFields).min(1).max(1000) }));
  return json(importClients(ctx, clients));
});
