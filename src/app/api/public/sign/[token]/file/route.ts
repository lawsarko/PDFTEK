import { get } from "@/lib/db";
import { route, notFound } from "@/lib/http";
import { readFile } from "@/lib/storage";

type P = { params: Promise<{ token: string }> };

/** Serves the PDF to a signer: the original while signing, the final signed copy once complete. */
export const GET = route<P>(async (req, { params }) => {
  const { token } = await params;
  const row = get<{ storage_key: string; signed_key: string | null; doc_name: string }>(
    `SELECT v.storage_key, sv.storage_key AS signed_key, d.name AS doc_name FROM signers s
       JOIN signature_requests r ON r.id = s.request_id JOIN documents d ON d.id = r.document_id
       JOIN document_versions v ON v.id = r.version_id
       LEFT JOIN document_versions sv ON sv.id = r.signed_version_id
      WHERE s.token = ?`,
    token,
  );
  if (!row) throw notFound();
  const signed = new URL(req.url).searchParams.get("signed") === "1" && row.signed_key;
  const data = await readFile(signed ? row.signed_key! : row.storage_key);
  const name = signed ? row.doc_name.replace(/\.pdf$/i, "") + " (signed).pdf" : row.doc_name;
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${signed ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
});
