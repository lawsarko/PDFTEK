import { SignLinkPage } from "./sign-link";

export const metadata = { title: "Sign a document", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SignLinkPage slug={slug} />;
}
