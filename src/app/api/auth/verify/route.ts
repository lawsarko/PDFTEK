import { run } from "@/lib/db";
import { now } from "@/lib/ids";
import { consumeToken } from "@/lib/tokens";
import { firstWorkspaceFor } from "@/lib/auth";

/** The link in the confirmation email. */
export async function GET(req: Request) {
  const userId = consumeToken(new URL(req.url).searchParams.get("token") ?? "", "verify");
  if (userId) run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", now(), userId);
  // Straight to the workspace: /app would drop the query string on its own redirect.
  const wid = userId ? firstWorkspaceFor(userId) : null;
  const location = userId ? `${wid ? `/app/${wid}` : "/app"}?verified=1` : "/login?verified=0";
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
