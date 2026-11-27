import { Suspense } from "react";
import { pageMeta } from "@/lib/seo-meta";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";
import { sbGoogleEnabled } from "@/lib/supabase";

export async function generateMetadata() {
  return pageMeta("/login", { title: "Sign in", description: "Sign in to your PDFTEK workspace.", index: false });
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
