import { badRequest, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { entitlements } from "@/lib/billing";
import { download, isProvider } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/**
 * Hands one file from Google Drive, Dropbox or OneDrive to the page as it is, for places that work on
 * a file picked in the browser (to Excel, convert to PDF, unlock, spreadsheets for bulk sending).
 * Same plan limits as uploading it.
 */
export const GET = route<P>(async (req, { params }) => {
  const { provider } = await params;
  if (!isProvider(provider)) throw badRequest("Unknown service.");
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || id.length > 500) throw badRequest("Choose a file.");
  const ctx = await requireMember(url.searchParams.get("workspaceId") ?? "");
  const f = await download(ctx.user.id, provider, id, entitlements(ctx, req).maxFileMb * 1024 * 1024);
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "cache-control": "no-store",
    },
  });
});
