import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { deleteProfile, updateProfile } from "@/lib/form-store";
import { ProfileDataSchema, scrubProfile } from "@/lib/form-schemas";

type P = { params: Promise<{ id: string }> };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const input = await body(req, z.object({ name: z.string().trim().min(1).max(60).optional(), kind: z.enum(["person", "business"]).optional(), data: ProfileDataSchema.optional() }));
  return json({ profile: updateProfile(user.id, id, { ...input, data: input.data && scrubProfile(input.data) }) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  deleteProfile(user.id, (await params).id);
  return json({ ok: true });
});
