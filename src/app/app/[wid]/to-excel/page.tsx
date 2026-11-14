import { Suspense } from "react";
import { ToExcel } from "./to-excel";

export const metadata = { title: "Statements & invoices to Excel" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <Suspense>
      <ToExcel wid={wid} />
    </Suspense>
  );
}
