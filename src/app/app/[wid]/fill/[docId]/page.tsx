import { FormFiller } from "./fill";

export const metadata = { title: "Fill form" };

export default async function Page({ params }: { params: Promise<{ wid: string; docId: string }> }) {
  const { wid, docId } = await params;
  return <FormFiller wid={wid} docId={docId} />;
}
