import { get } from "@/lib/db";
import { json, route, notFound } from "@/lib/http";
import { docAccess, pageTexts, type VersionRow } from "@/lib/documents";
import { readFile } from "@/lib/storage";
import { extractText } from "@/lib/pdf";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { doc } = await docAccess(id);
  const versionId = new URL(req.url).searchParams.get("version");
  if (!versionId || versionId === doc.current_version_id) return json({ pages: pageTexts(doc.id) });
  const v = get<VersionRow>("SELECT * FROM document_versions WHERE id = ? AND document_id = ?", versionId, doc.id);
  if (!v) throw notFound("Version not found.");
  const { pages } = await extractText(await readFile(v.storage_key));
  return json({ pages });
});
