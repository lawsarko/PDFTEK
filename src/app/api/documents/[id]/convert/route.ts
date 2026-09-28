import { route, badRequest } from "@/lib/http";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { pdfToDocx } from "@/lib/pdf-to-docx";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

/** PDF → editable Word document with real paragraphs (fonts, alignment, indents, tab stops). */
export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const to = new URL(req.url).searchParams.get("to");
  if (to !== "docx") throw badRequest("Unsupported target.");
  const out = await pdfToDocx(await readCurrentPdf(doc), doc.name.replace(/\.pdf$/i, ""));
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "converted", documentId: doc.id, meta: { to } });
  const name = doc.name.replace(/\.pdf$/i, "") + ".docx";
  return new Response(new Uint8Array(out), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});
