import { Suspense } from "react";
import { Directory } from "@/components/firm/directory";

export const metadata = { title: "Clients" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  return (
    <Suspense>
      <Directory wid={(await params).wid} />
    </Suspense>
  );
}
