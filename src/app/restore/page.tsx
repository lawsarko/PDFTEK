import { Suspense } from "react";
import { RestoreForm } from "./restore-form";

export const metadata = { title: "Restore a purchase" };

export default function RestorePage() {
  return (
    <Suspense>
      <RestoreForm />
    </Suspense>
  );
}
