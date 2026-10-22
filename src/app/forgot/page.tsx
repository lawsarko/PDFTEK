import { Suspense } from "react";
import { pageMeta } from "@/lib/seo-meta";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata() {
  return pageMeta("/forgot", { title: "Reset your password", description: "Get a link to reset your PDFTEK password.", index: false });
}

export default function Forgot() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
