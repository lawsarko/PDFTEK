import { SendForSignature } from "./send";

export const metadata = { title: "Request signatures" };

export default async function Page({ params, searchParams }: { params: Promise<{ wid: string; docId: string }>; searchParams: Promise<{ mode?: string; template?: string }> }) {
  const { wid, docId } = await params;
  const sp = await searchParams;
  const template = sp.template?.slice(0, 40);
  return <SendForSignature wid={wid} docId={docId} mode={sp.mode === "template" || template ? "template" : "send"} templateId={template} />;
}
