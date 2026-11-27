import { Inbox } from "@/components/firm/inbox";

export const metadata = { title: "Messages" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  return <Inbox wid={(await params).wid} />;
}
