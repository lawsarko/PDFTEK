import { json, route, badRequest } from "@/lib/http";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { hasServerOffice, pdfToOffice } from "@/lib/pdf";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

/** High-fidelity PDF → Word using LibreOffice on the server (when installed). */
export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const to = new URL(req.url).searchParams.get("to");
  if (to !== "docx") throw badRequest("Unsupported target.");
  if (!(await hasServerOffice())) return json({ error: "Server conversion unavailable", code: "no_server_office" }, 501);
  const out = await pdfToOffice(await readCurrentPdf(doc), "docx");
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "converted", documentId: doc.id, meta: { to } });
  const name = doc.name.replace(/\.pdf$/i, "") + ".docx";
  return new Response(new Uint8Array(out), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});
