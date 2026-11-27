import { all } from "@/lib/db";
import { json, route } from "@/lib/http";
import { firmCtx } from "@/lib/firm-api";

type P = { params: Promise<{ wid: string }> };

/** Clients with messages, newest conversation first, with unread counts. */
export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  await firmCtx(wid, { write: false });
  const rows = all<{ client_id: string; name: string; body: string; author: string; internal: number; created_at: number; unread: number }>(
    `SELECT c.id AS client_id, COALESCE(NULLIF(c.company, ''), c.name) AS name, m.body, m.author, m.internal, m.created_at,
            (SELECT COUNT(*) FROM client_messages u WHERE u.client_id = c.id AND u.author = 'client' AND u.read_at IS NULL) AS unread
       FROM clients c
       JOIN client_messages m ON m.id = (SELECT id FROM client_messages WHERE client_id = c.id ORDER BY created_at DESC LIMIT 1)
      WHERE c.workspace_id = ?
      ORDER BY m.created_at DESC LIMIT 300`,
    wid,
  );
  return json({ conversations: rows.map((r) => ({ clientId: r.client_id, name: r.name, unread: r.unread, last: { body: r.body, author: r.author, internal: Boolean(r.internal), createdAt: r.created_at } })) });
});
