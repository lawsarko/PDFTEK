import { redirect } from "next/navigation";
import { currentUser, firstWorkspaceFor, createWorkspace } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppIndex() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const wid = firstWorkspaceFor(user.id) ?? createWorkspace(`${user.name.split(" ")[0]}'s workspace`, user.id);
  redirect(`/app/${wid}`);
}
