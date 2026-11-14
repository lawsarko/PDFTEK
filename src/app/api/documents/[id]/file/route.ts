import { get } from "@/lib/db";
import { route, notFound } from "@/lib/http";
import { docAccess, type VersionRow } from "@/lib/documents";
import { readFile } from "@/lib/storage";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  const url = new URL(req.url);
  const versionId = url.searchParams.get("version") || doc.current_version_id;
  const v = get<VersionRow>("SELECT * FROM document_versions WHERE id = ? AND document_id = ?", versionId, doc.id);
  if (!v) throw notFound("Version not found.");
  const data = await readFile(v.storage_key);
  const download = url.searchParams.get("download") === "1";
  const name = v.id === doc.current_version_id ? doc.name : doc.name.replace(/\.pdf$/i, "") + ` (v${v.version}).pdf`;
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(data.length),
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, max-age=31536000, immutable",
      etag: v.sha256,
    },
  });
});
