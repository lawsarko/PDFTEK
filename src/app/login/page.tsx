import { Suspense } from "react";
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";
import { sbGoogleEnabled } from "@/lib/supabase";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("Sign in") };
}
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const user = await currentUser();
  // Guests are "signed in" to a temporary account; let them sign up or sign in properly.
  if (user && !user.is_guest && !invite) redirect("/app");
  return (
    <Suspense>
      <AuthForm mode="login" inviteToken={invite} google={await sbGoogleEnabled()} />
    </Suspense>
  );
}
