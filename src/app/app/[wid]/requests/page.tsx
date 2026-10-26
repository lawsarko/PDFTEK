import { Suspense } from "react";
import { Requests } from "./requests";

export const metadata = { title: "Document requests" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <Requests wid={wid} />
    </Suspense>
  );
}
