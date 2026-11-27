import { notFound, redirect } from "next/navigation";
import { brand, firmBySlug } from "@/lib/firm";
import { currentClient } from "@/lib/client-portal";
import { Portal } from "@/components/portal/portal";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: P) {
  const f = firmBySlug((await params).slug);
  return { title: { absolute: f ? `${brand(f).name} · Client portal` : "Client portal" }, robots: { index: false, follow: false } };
}

/** A firm's client portal (also served at the firm's own address, e.g. sark.pdftek.com). */
export default async function PortalPage({ params, searchParams }: P) {
  const { slug } = await params;
  const q = await searchParams;
  const f = firmBySlug(slug);
  if (!f) notFound();
  // One-click sign-in links set the session cookie in a route handler, then come back here.
  if (q.login) redirect(`/api/portal/${slug}/link?t=${encodeURIComponent(q.login)}`);
  const who = await currentClient(slug);
  return <Portal slug={slug} brand={brand(f)} signedIn={Boolean(who)} expired={q.expired === "1"} />;
}
