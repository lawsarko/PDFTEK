import { all } from "@/lib/db";
import { json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await requireMember(wid);
  const docId = new URL(req.url).searchParams.get("doc");
  const rows = all<{ id: string; action: string; actor: string | null; actor_label: string | null; document_id: string | null; doc_name: string | null; meta_json: string; created_at: number }>(
    `SELECT a.id, a.action, u.name AS actor, a.actor_label, a.document_id, d.name AS doc_name, a.meta_json, a.created_at
       FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN documents d ON d.id = a.document_id
      WHERE a.workspace_id = ? ${docId ? "AND a.document_id = ?" : ""}
      ORDER BY a.created_at DESC LIMIT 60`,
    ...(docId ? [wid, docId] : [wid]),
  );
  return json({
    activity: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor ?? r.actor_label ?? "Someone",
      documentId: r.document_id,
      documentName: r.doc_name,
      meta: JSON.parse(r.meta_json),
      createdAt: r.created_at,
    })),
  });
});
