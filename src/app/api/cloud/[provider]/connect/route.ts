import { badRequest, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { authorizeUrl, isProvider } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

/** Starts connecting a cloud account: sends the person to the service's sign-in page. */
export const GET = route<P>(async (req, { params }) => {
  const { provider } = await params;
  if (!isProvider(provider)) throw badRequest("Unknown service.");
  const user = await requireUser();
  const back = new URL(req.url).searchParams.get("return") ?? "/app";
  const safe = back.startsWith("/") && !back.startsWith("//") ? back : "/app";
  return Response.redirect(authorizeUrl(provider, user.id, safe), 302);
});
