import { Suspense } from "react";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset your password" };

export default function Forgot() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
