import { get } from "@/lib/db";
import { notFound, route } from "@/lib/http";
import { clientFile, requireClient } from "@/lib/client-portal";
import { readFile } from "@/lib/storage";

type P = { params: Promise<{ slug: string; fid: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { slug, fid } = await params;
  const { client } = await requireClient(slug);
  const f = clientFile(client, fid);
  const v = get<{ storage_key: string; name: string }>(
    "SELECT v.storage_key, d.name FROM documents d JOIN document_versions v ON v.id = d.current_version_id WHERE d.id = ? AND d.deleted_at IS NULL",
    f.document_id,
  );
  if (!v) throw notFound("File not found.");
  const data = await readFile(v.storage_key);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(v.name)}`,
      "cache-control": "private, no-store",
    },
  });
});
