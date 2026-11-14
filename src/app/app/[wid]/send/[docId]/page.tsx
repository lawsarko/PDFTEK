import { SendForSignature } from "./send";

export const metadata = { title: "Request signatures" };

export default async function Page({ params }: { params: Promise<{ wid: string; docId: string }> }) {
  const { wid, docId } = await params;
  return <SendForSignature wid={wid} docId={docId} />;
}
