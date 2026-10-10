import { route, badRequest } from "@/lib/http";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { pdfToDocx } from "@/lib/pdf-to-docx";
import { pdfToXlsx } from "@/lib/pdf-to-xlsx";
import { logActivity } from "@/lib/activity";
import { metered } from "@/lib/billing";

type P = { params: Promise<{ id: string }> };

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/** PDF → Word or Excel that keeps the document's formatting (fonts, alignment, spacing, rules, links). */
export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const to = new URL(req.url).searchParams.get("to");
  if (to !== "docx" && to !== "xlsx") throw badRequest("Unsupported target.");
  const title = doc.name.replace(/\.pdf$/i, "");
  const pdf = await readCurrentPdf(doc);
  const out = await metered(ctx, req, to === "docx" ? "PDF to Word" : "PDF to Excel", () => (to === "docx" ? pdfToDocx(pdf, title) : pdfToXlsx(pdf, title)));
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "converted", documentId: doc.id, meta: { to } });
  return new Response(new Uint8Array(out), {
    headers: { "content-type": TYPES[to], "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.${to}`)}` },
  });
});
