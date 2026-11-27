import { z } from "zod";
import { run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route, badRequest } from "@/lib/http";
import { membership } from "@/lib/auth";
import { docAccess, serializeDoc, getDocument, assertCanEdit } from "@/lib/documents";
import { logActivity, notify } from "@/lib/activity";
import { get } from "@/lib/db";
import { appUrl, sendMail } from "@/lib/mail";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const input = await body(req, z.object({ userId: z.string(), note: z.string().max(1000).optional().default("") }));
  assertCanEdit(doc, ctx.user.id);
  if (!membership(ctx.workspace.id, input.userId)) throw badRequest("That person isn't in this workspace.");
  const holding = doc.checked_out_by === ctx.user.id;
  run(
    "UPDATE documents SET assigned_to = ?, checked_out_by = ?, checked_out_at = ?, updated_at = ? WHERE id = ?",
    input.userId,
    holding ? input.userId : doc.checked_out_by,
    holding ? now() : doc.checked_out_at,
    now(),
    id,
  );
  const target = get<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", input.userId)!;
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "handed_off", documentId: id, meta: { to: target.name, note: input.note } });
  if (input.userId !== ctx.user.id) {
    const link = `/app/${ctx.workspace.id}?doc=${id}`;
    notify({ userId: input.userId, workspaceId: ctx.workspace.id, title: `${ctx.user.name} handed you ${doc.name}`, body: input.note, link });
    await sendMail({
      to: target.email,
      subject: `${ctx.user.name} handed you ${doc.name}`,
      heading: `${doc.name} is now assigned to you`,
      paragraphs: [`${ctx.user.name} handed this document off to you${holding ? " along with the edit lock" : ""}.`, ...(input.note ? [`Note: ${input.note}`] : [])],
      cta: { label: "Open document", url: appUrl(link) },
    });
  }
  return json({ document: serializeDoc(getDocument(ctx, id)) });
});
