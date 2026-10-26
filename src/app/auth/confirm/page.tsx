import { Confirm } from "./confirm";

export const metadata = { title: "Signing you in" };

/** Supabase email links (confirm email, reset password, sign-in link) land here. */
export default function ConfirmPage() {
  return <Confirm />;
}
