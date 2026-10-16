import { Suspense } from "react";
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";
import { sbGoogleEnabled } from "@/lib/supabase";
import { get } from "@/lib/db";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("Create account") };
}
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
