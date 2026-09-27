import "server-only";
import { all, insert, run } from "./db";
import { id, now } from "./ids";
import { describeAiError, streamChat, type Segment, type Source, type SourceRef } from "./ai";

export type StoredMessage = { id: string; role: "user" | "assistant"; segments: Segment[]; refs: SourceRef[]; createdAt: number };

export function history(workspaceId: string, userId: string, documentId: string | null): StoredMessage[] {
  const rows = all<{ id: string; role: "user" | "assistant"; content: string; citations_json: string; created_at: number }>(
    `SELECT id, role, content, citations_json, created_at FROM chat_messages
      WHERE workspace_id = ? AND user_id = ? AND document_id IS ? ORDER BY created_at ASC LIMIT 200`,
    workspaceId,
    userId,
    documentId,
  );
  return rows.map((r) => {
    const meta = JSON.parse(r.citations_json) as { segments?: Segment[]; refs?: SourceRef[] } | unknown[];
    const segs = !Array.isArray(meta) && meta.segments ? meta.segments : [{ text: r.content, citations: [] }];
    return { id: r.id, role: r.role, segments: segs, refs: !Array.isArray(meta) ? (meta.refs ?? []) : [], createdAt: r.created_at };
  });
}

export function clearHistory(workspaceId: string, userId: string, documentId: string | null) {
  run("DELETE FROM chat_messages WHERE workspace_id = ? AND user_id = ? AND document_id IS ?", workspaceId, userId, documentId);
}

/** Streams an answer as NDJSON and persists both turns. */
export function chatResponse(opts: {
  workspaceId: string;
  userId: string;
  documentId: string | null;
  question: string;
  sources: Source[];
  refs: SourceRef[];
  extraSystem?: string;
}): Response {
  const prior = history(opts.workspaceId, opts.userId, opts.documentId).map((m) => ({
    role: m.role,
    content: m.segments.map((s) => s.text).join(""),
  }));
  insert("chat_messages", {
    id: id("msg_"),
    workspace_id: opts.workspaceId,
    document_id: opts.documentId,
    user_id: opts.userId,
    role: "user",
    content: opts.question,
    citations_json: "[]",
    created_at: now(),
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ type: "refs", refs: opts.refs });
      let segments: Segment[] = [];
      try {
        const gen = streamChat({ sources: opts.sources, history: prior, question: opts.question, extraSystem: opts.extraSystem });
        while (true) {
          const next = await gen.next();
          if (next.done) {
            segments = next.value.segments;
            break;
          }
          send(next.value);
        }
        const msgId = id("msg_");
        insert("chat_messages", {
          id: msgId,
          workspace_id: opts.workspaceId,
          document_id: opts.documentId,
          user_id: opts.userId,
          role: "assistant",
          content: segments.map((s) => s.text).join(""),
          citations_json: JSON.stringify({ segments, refs: opts.refs }),
          created_at: now(),
        });
        send({ type: "done", id: msgId });
      } catch (err) {
        console.error("[pdftek] chat failed", err);
        send({ type: "error", error: describeAiError(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
