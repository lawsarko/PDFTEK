import { json, route } from "@/lib/http";
import { configured, PROVIDERS } from "@/lib/cloud";

/** Public: whether any cloud storage service is set up, so public pages can offer "From cloud". */
export const GET = route(async () => {
  return json({ available: PROVIDERS.some(configured) }, 200);
});
