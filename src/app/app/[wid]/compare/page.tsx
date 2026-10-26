import { Suspense } from "react";
import { Compare } from "./compare";

export const metadata = { title: "Compare" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <Compare wid={wid} />
    </Suspense>
  );
}
