import { badRequest, json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { pickerConfig } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

/** Settings for Google's file picker in the browser (Google Drive only). */
export const GET = route<P>(async (_req, { params }) => {
  const { provider } = await params;
  if (provider !== "google") throw badRequest("Only Google Drive uses the picker.");
  const user = await requireUser();
  return json(await pickerConfig(user.id));
});
