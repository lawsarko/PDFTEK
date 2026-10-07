import { json, route, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { createDocument, serializeDoc } from "@/lib/documents";
import { unlockPdf } from "@/lib/pdf-security";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ wid: string }> };

/** Removes the password from an uploaded PDF and adds the unlocked copy to the library. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const form = await req.formData();
  const file = form.get("file");
  const password = String(form.get("password") ?? "");
  if (!(file instanceof File)) throw badRequest("Choose a PDF.");
  if (file.size > 60 * 1024 * 1024) throw badRequest("File is larger than 60 MB.");
  if (password.length > 256) throw badRequest("That password is too long.");
  const pdf = await unlockPdf(new Uint8Array(await file.arrayBuffer()), password);
  const name = file.name.replace(/\.pdf$/i, "").slice(0, 180) + " (unlocked).pdf";
  const doc = await createDocument({ workspaceId: wid, userId: ctx.user.id, name, data: pdf });
  logActivity({ workspaceId: wid, userId: ctx.user.id, action: "unlocked", documentId: doc.id });
  return json({ document: serializeDoc(doc) });
});
