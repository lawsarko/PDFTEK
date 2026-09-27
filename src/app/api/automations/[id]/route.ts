import { z } from "zod";
import { all, get, run, update } from "@/lib/db";
import { body, json, route, notFound } from "@/lib/http";
import { requireMember, requirePlan } from "@/lib/auth";
import { ActionSchema, TriggerSchema, computeNextRun, runAutomationNow, type AutomationRow } from "@/lib/automations";
import { validateActions, serializeAutomation } from "@/lib/automation-validate";

type P = { params: Promise<{ id: string }> };

async function load(id: string) {
  const a = get<AutomationRow>("SELECT * FROM automations WHERE id = ?", id);
  if (!a) throw notFound();
  const ctx = await requireMember(a.workspace_id);
  return { a, ctx };
}

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { a } = await load(id);
  const runs = all("SELECT id, status, log, document_id AS documentId, created_at AS createdAt FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT 25", a.id);
  return json({ automation: serializeAutomation(a), runs });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  trigger: TriggerSchema.optional(),
  actions: z.array(ActionSchema).max(10).optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { a } = await load(id);
  const input = await body(req, Patch);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;
  if (input.actions) {
    validateActions(input.actions);
    patch.actions_json = JSON.stringify(input.actions);
  }
  const trigger = input.trigger ?? JSON.parse(a.trigger_json);
  if (input.trigger) {
    patch.trigger_type = input.trigger.type;
    patch.trigger_json = JSON.stringify(input.trigger);
  }
  patch.next_run_at = computeNextRun(trigger);
  update("automations", a.id, patch);
  return json({ automation: serializeAutomation(get<AutomationRow>("SELECT * FROM automations WHERE id = ?", a.id)!) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { a } = await load(id);
  run("DELETE FROM automations WHERE id = ?", a.id);
  return json({ ok: true });
});

/** Runs an automation immediately (optionally against a specific document). */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { a, ctx } = await load(id);
  requirePlan(ctx, "Automations");
  const { documentId } = await body(req, z.object({ documentId: z.string().optional() }));
  if (documentId && !get("SELECT 1 FROM documents WHERE id = ? AND workspace_id = ?", documentId, a.workspace_id)) throw notFound("Document not found.");
  await runAutomationNow(a, documentId);
  return json({ automation: serializeAutomation(get<AutomationRow>("SELECT * FROM automations WHERE id = ?", a.id)!) });
});
