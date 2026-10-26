import { Suspense } from "react";
import { Tools } from "./tools";

export const metadata = { title: "PDF tools" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <Tools wid={wid} />
    </Suspense>
  );
}
