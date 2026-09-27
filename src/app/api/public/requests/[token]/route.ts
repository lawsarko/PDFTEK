import { get, run } from "@/lib/db";
import { now } from "@/lib/ids";
import { clientIp, json, route, notFound, badRequest } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { createDocument } from "@/lib/documents";
import { logActivity, notify } from "@/lib/activity";

type P = { params: Promise<{ token: string }> };

type Req = {
  id: string;
  workspace_id: string;
  title: string;
  message: string;
  recipient_name: string;
  due_date: string | null;
  status: string;
  created_by: string;
  viewed_at: number | null;
};

function load(token: string) {
  const r = get<Req & { workspace_name: string; requester: string }>(
    `SELECT r.*, w.name AS workspace_name, u.name AS requester FROM doc_requests r
       JOIN workspaces w ON w.id = r.workspace_id JOIN users u ON u.id = r.created_by WHERE r.token = ?`,
    token,
  );
  if (!r) throw notFound("This request link is invalid.");
  return r;
}

export const GET = route<P>(async (_req, { params }) => {
  const { token } = await params;
  const r = load(token);
  if (!r.viewed_at && r.status === "pending") {
    run("UPDATE doc_requests SET viewed_at = ?, status = 'viewed' WHERE id = ?", now(), r.id);
  }
  return json({
    title: r.title,
    message: r.message,
    recipientName: r.recipient_name,
    dueDate: r.due_date,
    status: r.status === "pending" ? "viewed" : r.status,
    workspaceName: r.workspace_name,
    requester: r.requester,
  });
});

export const POST = route<P>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`public-upload:${clientIp(req)}`, 30, 3600_000);
  const r = load(token);
  if (r.status === "complete") throw badRequest("This request has already been fulfilled.");
  if (r.status === "cancelled") throw badRequest("This request was cancelled.");
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 10);
  if (!files.length) throw badRequest("Choose a file to upload.");
  let firstId: string | null = null;
  for (const f of files) {
    if (f.size > 60 * 1024 * 1024) throw badRequest(`${f.name} is larger than 60 MB.`);
    const doc = await createDocument({
      workspaceId: r.workspace_id,
      userId: r.created_by,
      name: `${r.title} — ${r.recipient_name}${files.length > 1 ? ` (${f.name})` : ""}.${(f.name.split(".").pop() || "pdf").toLowerCase()}`,
      data: Buffer.from(await f.arrayBuffer()),
      tags: ["requested"],
      actorLabel: `${r.recipient_name} (via request)`,
    });
    firstId ??= doc.id;
  }
  run("UPDATE doc_requests SET status = 'complete', completed_at = ?, document_id = ? WHERE id = ?", now(), firstId, r.id);
  logActivity({ workspaceId: r.workspace_id, actorLabel: r.recipient_name, action: "fulfilled_request", documentId: firstId, meta: { title: r.title } });
  notify({ userId: r.created_by, workspaceId: r.workspace_id, title: `${r.recipient_name} uploaded ${r.title}`, link: `/app/${r.workspace_id}?doc=${firstId}` });
  import("@/lib/automations").then((m) =>
    m.onEvent("request_completed", { workspaceId: r.workspace_id, documentId: firstId ?? undefined, headline: `${r.recipient_name} uploaded ${r.title}` }),
  ).catch((e) => console.error(e));
  return json({ ok: true });
});
