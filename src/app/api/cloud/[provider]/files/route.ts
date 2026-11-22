import { badRequest, json, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { isProvider, listFolder } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

/** Lists a folder or search results in Dropbox or OneDrive (folders first, then files A–Z). */
export const GET = route<P>(async (req, { params }) => {
  const { provider } = await params;
  if (!isProvider(provider)) throw badRequest("Unknown service.");
  const user = await requireUser();
  const url = new URL(req.url);
  const items = await listFolder(user.id, provider, url.searchParams.get("folder") ?? "", url.searchParams.get("q") ?? "");
  items.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1));
  return json({ items });
});
