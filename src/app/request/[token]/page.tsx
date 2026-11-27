import { RequestUpload } from "./upload";

export const metadata = { title: "Upload requested document", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RequestUpload token={token} />;
}
