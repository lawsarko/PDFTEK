import { z } from "zod";
import { body, route } from "@/lib/http";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { protectPdf } from "@/lib/pdf-security";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

const Input = z.object({
  password: z.string().min(4, "Use at least 4 characters.").max(128),
  printing: z.boolean().default(true),
  copying: z.boolean().default(true),
  modifying: z.boolean().default(false),
});

/**
 * Returns a password-protected copy (AES-256) for download. The library copy stays unlocked so it
 * can still be viewed, searched and edited in pdftek.
 */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const input = await body(req, Input);
  const out = await protectPdf(await readCurrentPdf(doc), input.password, input);
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "protected", documentId: doc.id });
  const name = doc.name.replace(/\.pdf$/i, "") + " (protected).pdf";
  return new Response(new Uint8Array(out), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
});
