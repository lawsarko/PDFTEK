import { Dashboard } from "@/components/firm/dashboard";

export const metadata = { title: "Clients" };

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  return <Dashboard wid={(await params).wid} />;
}
