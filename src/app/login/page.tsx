import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const user = await currentUser();
  // Guests are "signed in" to a temporary account; let them sign up or sign in properly.
  if (user && !user.is_guest && !invite) redirect("/app");
  return (
    <Suspense>
      <AuthForm mode="login" inviteToken={invite} />
    </Suspense>
  );
}
