import { z } from "zod";
import { run } from "@/lib/db";
import { now } from "@/lib/ids";
import { body, json, route, conflict, forbidden } from "@/lib/http";
import { docAccess, serializeDoc, getDocument, userNames } from "@/lib/documents";
import { logActivity, notify } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const { action } = await body(req, z.object({ action: z.enum(["checkout", "checkin", "force_checkin"]) }));
  if (action === "checkout") {
    if (doc.checked_out_by && doc.checked_out_by !== ctx.user.id) {
      throw conflict(`${userNames([doc.checked_out_by])[doc.checked_out_by] ?? "Another member"} already has this checked out.`);
    }
    run("UPDATE documents SET checked_out_by = ?, checked_out_at = ? WHERE id = ?", ctx.user.id, now(), id);
    logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "checked_out", documentId: id });
  } else {
    if (doc.checked_out_by && doc.checked_out_by !== ctx.user.id) {
      if (action !== "force_checkin" || ctx.role === "member") throw forbidden("Only the holder or an admin can check this in.");
      notify({ userId: doc.checked_out_by, workspaceId: ctx.workspace.id, title: `${ctx.user.name} released your lock on ${doc.name}`, link: `/app/${ctx.workspace.id}?doc=${id}` });
    }
    run("UPDATE documents SET checked_out_by = NULL, checked_out_at = NULL WHERE id = ?", id);
    logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "checked_in", documentId: id });
  }
  return json({ document: serializeDoc(getDocument(ctx, id)) });
});
