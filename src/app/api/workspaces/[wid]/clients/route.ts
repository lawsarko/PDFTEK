import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { clientDTO, createClient, listClients } from "@/lib/clients";
import { seasonYear } from "@/lib/client-shared";
import { ClientFields } from "@/lib/client-schemas";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await firmCtx(wid, { write: false });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || seasonYear();
  return json({ year, clients: listClients(wid, { archived: url.searchParams.get("archived") === "1", year }) });
});


export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await firmCtx(wid);
  const input = await body(req, ClientFields);
  return json({ client: clientDTO(createClient(ctx, input)) });
});
