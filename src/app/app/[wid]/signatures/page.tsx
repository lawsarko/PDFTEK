import { Suspense } from "react";
import { Signatures } from "./signatures";

export const metadata = { title: "E-signatures" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <Signatures wid={wid} />
    </Suspense>
  );
}
