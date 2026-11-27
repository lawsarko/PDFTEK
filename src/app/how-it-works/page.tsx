import { permanentRedirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";

/** The step-by-step guide moved to the Help Center. */
export default async function HowItWorks() {
  const { lp } = await getI18n();
  permanentRedirect(lp("/help"));
}
