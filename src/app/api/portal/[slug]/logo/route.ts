import { notFound } from "@/lib/http";
import { firmBySlug } from "@/lib/firm";
import { readFile } from "@/lib/storage";

type P = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: P) {
  const f = firmBySlug((await params).slug);
  if (!f?.brand_logo_key) return new Response(notFound().message, { status: 404 });
  const data = await readFile(f.brand_logo_key);
  return new Response(new Uint8Array(data), { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });
}
