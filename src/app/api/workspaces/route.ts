import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { createWorkspace, requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { name } = await body(req, z.object({ name: z.string().trim().min(1).max(80) }));
  const workspaceId = createWorkspace(name, user.id);
  logActivity({ workspaceId, userId: user.id, action: "created_workspace" });
  return json({ workspaceId });
});
