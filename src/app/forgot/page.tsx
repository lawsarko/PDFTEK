import { Suspense } from "react";
import { getI18n } from "@/lib/i18n/server";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("Reset your password") };
}

export default function Forgot() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
