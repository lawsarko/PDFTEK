import { Suspense } from "react";
import { Settings } from "./settings";

export const metadata = { title: "Settings" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <Settings wid={wid} />
    </Suspense>
  );
}
