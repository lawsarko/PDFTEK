import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";
import { archiveClient, clientDetail, markClientMessagesRead, postFirmMessage, remindClientDigest, requestForClient, setStage, stopSchedule, updateClient, createSchedule } from "@/lib/clients";
import { inviteClient } from "@/lib/client-portal";
import { STAGE_KEYS } from "@/lib/client-shared";
import { ClientFields, RequestSpec } from "@/lib/client-schemas";

type P = { params: Promise<{ wid: string; cid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid, cid } = await params;
  const ctx = await firmCtx(wid, { write: false });
  return json(clientDetail(ctx, cid));
});


const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), client: ClientFields.partial() }),
  z.object({ action: z.literal("archive"), archived: z.boolean() }),
  z.object({ action: z.literal("stage"), year: z.number().int(), status: z.enum(STAGE_KEYS), service: z.string().max(60).optional(), dueDate: z.string().nullable().optional() }),
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("remind") }),
  z.object({ action: z.literal("message"), body: z.string().min(1).max(5000), internal: z.boolean().default(false) }),
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("request"), spec: RequestSpec, repeat: z.object({ every: z.enum(["month", "quarter", "year"]), startAt: z.number() }).nullable().optional() }),
  z.object({ action: z.literal("stop_schedule"), scheduleId: z.string() }),
]);

export const POST = route<P>(async (req, { params }) => {
  const { wid, cid } = await params;
  const input = await body(req, Action);
  const ctx = await firmCtx(wid, { write: input.action !== "read" });
  switch (input.action) {
    case "update":
      updateClient(ctx, cid, input.client);
      return json({ ok: true });
    case "archive":
      archiveClient(ctx, cid, input.archived);
      return json({ ok: true });
    case "stage":
      setStage(ctx, cid, input.year, input.status, input.service, input.dueDate);
      return json({ ok: true });
    case "invite":
      return json(await inviteClient(ctx, cid));
    case "remind":
      return json(await remindClientDigest(cid));
    case "message":
      await postFirmMessage(ctx, cid, input.body, input.internal);
      return json({ ok: true });
    case "read":
      markClientMessagesRead(ctx, cid);
      return json({ ok: true });
    case "request": {
      const out = await requestForClient(ctx, cid, input.spec);
      if (input.repeat) createSchedule(ctx, cid, input.repeat.every, input.repeat.startAt, input.spec);
      return json(out);
    }
    case "stop_schedule":
      stopSchedule(wid, input.scheduleId);
      return json({ ok: true });
  }
});
