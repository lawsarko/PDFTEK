import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentUser, membership } from "@/lib/auth";
import { get } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  // The page being opened, with its query (?doc=…&do=…), so people land exactly where they meant to.
  const raw = (await headers()).get("x-pdftek-path") ?? "";
  const here = raw.startsWith(`/app/${wid}`) ? raw : `/app/${wid}`;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);
  if (!membership(wid, user.id)) {
    // A guest workspace that was merged into this account at sign-in: same page, in the account.
    const moved = get<{ to_id: string }>("SELECT to_id FROM workspace_moves WHERE from_id = ?", wid);
    if (moved && membership(moved.to_id, user.id)) redirect(`/app/${moved.to_id}${here.slice(`/app/${wid}`.length)}`);
    notFound();
  }
  return children;
}
