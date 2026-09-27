import { Suspense } from "react";
import { Workbench } from "@/components/workbench/workbench";

export const metadata = { title: "Workbench" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <Workbench wid={wid} />
    </Suspense>
  );
}
