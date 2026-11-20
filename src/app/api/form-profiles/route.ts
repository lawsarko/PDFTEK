import { z } from "zod";
import { body, json, route, badRequest } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createProfile, listProfiles } from "@/lib/form-store";
import { ProfileDataSchema, scrubProfile } from "@/lib/form-schemas";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ profiles: listProfiles(user.id) });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await body(req, z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["person", "business"]).default("person"), data: ProfileDataSchema.optional() }));
  if (listProfiles(user.id).length >= 20) throw badRequest("You can keep up to 20 profiles.");
  return json({ profile: createProfile(user.id, input.name, input.kind, input.data && scrubProfile(input.data)) });
});
