import { appUrl } from "@/lib/mail";
import { completeAuthorization, isProvider } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

const back = (path: string, params: Record<string, string>) => {
  const u = new URL(appUrl(path));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return Response.redirect(u.toString(), 302);
};

/** The service sends the person back here after they allow access. */
export async function GET(req: Request, { params }: P) {
  const { provider } = await params;
  const url = new URL(req.url);
  if (!isProvider(provider)) return back("/app", { cloud_error: "Unknown service." });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code) return back("/app", { cloud_error: url.searchParams.get("error_description") || "Access wasn't granted." });
  try {
    const to = await completeAuthorization(provider, state, code);
    return back(to, { cloud: provider });
  } catch (e) {
    return back("/app", { cloud_error: e instanceof Error ? e.message : "Couldn't connect. Please try again." });
  }
}
