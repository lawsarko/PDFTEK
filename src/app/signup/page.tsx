import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";
import { sbGoogleEnabled } from "@/lib/supabase";
import { get } from "@/lib/db";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function Signup({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const user = await currentUser();
  // Guests are "signed in" to a temporary account; let them sign up or sign in properly.
  if (user && !user.is_guest && !invite) redirect("/app");
  const inv = invite
    ? get<{ email: string; name: string }>("SELECT i.email, w.name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ? AND i.accepted_at IS NULL", invite)
    : undefined;
  return (
    <Suspense>
      <AuthForm mode="signup" inviteToken={inv ? invite : undefined} inviteEmail={inv?.email} workspaceName={inv?.name} google={await sbGoogleEnabled()} />
    </Suspense>
  );
}
