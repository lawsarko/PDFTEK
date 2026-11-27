import { json, route } from "@/lib/http";
import { currentOrGuest } from "@/lib/auth";

/**
 * Called by the upload area on the public tool pages, only once someone actually adds a file: makes
 * sure there is a session (a guest one for visitors without an account, like /go/… links) and returns
 * the workspace the files go to.
 */
export const POST = route(async (req) => {
  const { workspaceId } = await currentOrGuest(req);
  return json({ workspaceId });
});
