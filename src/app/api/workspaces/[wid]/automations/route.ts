import { z } from "zod";
import { all, insert } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { body, json, route } from "@/lib/http";
import { requireMember, requirePlan } from "@/lib/auth";
import { ActionSchema, TriggerSchema, computeNextRun, type AutomationRow } from "@/lib/automations";
import { validateActions, serializeAutomation } from "@/lib/automation-validate";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const rows = all<AutomationRow>("SELECT * FROM automations WHERE workspace_id = ? ORDER BY created_at", wid);
  return json({ automations: rows.map(serializeAutomation) });
});

const Input = z.object({ name: z.string().trim().min(1).max(100), trigger: TriggerSchema, actions: z.array(ActionSchema).max(10) });

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  requirePlan(ctx, "Automations");
  const input = await body(req, Input);
  validateActions(input.actions);
  const row: AutomationRow = {
    id: id("aut_"),
    workspace_id: wid,
    name: input.name,
    enabled: 1,
    trigger_type: input.trigger.type,
    trigger_json: JSON.stringify(input.trigger),
    actions_json: JSON.stringify(input.actions),
    created_by: ctx.user.id,
    created_at: now(),
    last_run_at: null,
    next_run_at: computeNextRun(input.trigger),
  };
  insert("automations", row);
  return json({ automation: serializeAutomation(row) });
});
