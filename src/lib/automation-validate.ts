import "server-only";
import { badRequest } from "./http";
import type { Action, AutomationRow } from "./automations";
import { get } from "./db";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

/** Blocks webhook targets on private networks (basic SSRF guard) and requires https. */
export function validateActions(actions: Action[]) {
  for (const a of actions) {
    if (a.type === "webhook") {
      const u = new URL(a.url);
      if (u.protocol !== "https:") throw badRequest("Webhook URLs must use https.");
      const host = u.hostname;
      if (PRIVATE_HOST.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".internal") || host.endsWith(".local")) {
        throw badRequest("Webhook URLs must point to a public host.");
      }
    }
  }
  if (!actions.length) throw badRequest("Add at least one action.");
}

export function serializeAutomation(a: AutomationRow) {
  const lastRun = get<{ status: string; log: string; created_at: number }>(
    "SELECT status, log, created_at FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT 1",
    a.id,
  );
  return {
    id: a.id,
    name: a.name,
    enabled: Boolean(a.enabled),
    trigger: JSON.parse(a.trigger_json),
    actions: JSON.parse(a.actions_json),
    lastRunAt: a.last_run_at,
    nextRunAt: a.next_run_at,
    lastRun: lastRun ? { status: lastRun.status, log: lastRun.log, at: lastRun.created_at } : null,
  };
}

