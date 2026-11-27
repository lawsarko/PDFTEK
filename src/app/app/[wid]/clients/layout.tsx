import { FirmShell } from "@/components/firm/shell";

export const metadata = { title: "Clients" };

export default async function ClientsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return <FirmShell wid={wid}>{children}</FirmShell>;
}
