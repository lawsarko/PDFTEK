import { notFound, redirect } from "next/navigation";
import { currentUser, membership } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/app/${wid}`);
  if (!membership(wid, user.id)) notFound();
  return children;
}
