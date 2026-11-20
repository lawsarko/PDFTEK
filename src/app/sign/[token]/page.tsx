import { SignPage } from "./sign";

export const metadata = { title: "Review & sign", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignPage token={token} />;
}
