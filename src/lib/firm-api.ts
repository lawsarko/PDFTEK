import "server-only";
import { requireMember, type Role } from "./auth";
import { requireFirmPlan } from "./firm";

/** A member of the workspace, on a plan that includes Clients (for changes). Reading stays open if the plan lapses. */
export async function firmCtx(wid: string, opts: { write?: boolean; role?: Role } = {}) {
  const ctx = await requireMember(wid, opts.role ?? "member");
  if (opts.write !== false) requireFirmPlan(ctx);
  return ctx;
}
