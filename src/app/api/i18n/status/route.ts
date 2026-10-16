import { json, route, forbidden } from "@/lib/http";
import { currentUser } from "@/lib/auth";
import { translationStatus } from "@/lib/i18n/worker";

/** Translation progress per language (site admins only). */
export const GET = route(async () => {
  const user = await currentUser();
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  if (!user || !admins.includes(user.email.toLowerCase())) throw forbidden("Admins only.");
  return json(translationStatus());
});
