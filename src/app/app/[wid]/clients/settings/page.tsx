import { FirmSettings } from "@/components/firm/settings";

export const metadata = { title: "Firm settings" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  return <FirmSettings wid={(await params).wid} />;
}
