import { Suspense } from "react";
import { ClientProfile } from "@/components/firm/profile";

export const metadata = { title: "Client" };

export default async function Page({ params }: { params: Promise<{ wid: string; cid: string }> }) {
  const { wid, cid } = await params;
  return (
    <Suspense>
      <ClientProfile wid={wid} cid={cid} />
    </Suspense>
  );
}
