import { z } from "zod";
import { get } from "@/lib/db";
import { body, json, route, HttpError } from "@/lib/http";
import { requireMember, rateLimit } from "@/lib/auth";
import { searchWorkspace } from "@/lib/documents";
import { chatResponse, clearHistory, history } from "@/lib/chat";
import { aiConfigured, type Source, type SourceRef } from "@/lib/ai";

type P = { params: Promise<{ wid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  return json({ messages: history(wid, ctx.user.id, null) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  clearHistory(wid, ctx.user.id, null);
  return json({ ok: true });
});

/** Knowledge-base chat: retrieves the most relevant pages across the workspace and answers with citations. */
export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  if (!aiConfigured()) throw new HttpError(503, "AI features need an Anthropic API key. Set ANTHROPIC_API_KEY on the server.", "ai_not_configured");
  rateLimit(`chat:${ctx.user.id}`, ctx.plan === "free" ? 30 : 300, 24 * 3600_000);
  const { question } = await body(req, z.object({ question: z.string().trim().min(1).max(4000) }));
  const hits = searchWorkspace(wid, question, 24);
  const sources: Source[] = [];
  const refs: SourceRef[] = [];
  for (const h of hits) {
    const page = get<{ body: string }>("SELECT body FROM page_text WHERE document_id = ? AND page = ?", h.document_id, h.page);
    if (!page?.body.trim()) continue;
    sources.push({ kind: "text", title: `${h.name} — page ${h.page}`, text: page.body.slice(0, 12000) });
    refs.push({ documentId: h.document_id, documentName: h.name, page: h.page });
    if (sources.length >= 16) break;
  }
  if (!sources.length) {
    sources.push({ kind: "text", title: "Knowledge base", text: "No pages in the workspace matched this question." });
    refs.push({ documentId: "", documentName: "Knowledge base" });
  }
  return chatResponse({
    workspaceId: wid,
    userId: ctx.user.id,
    documentId: null,
    question,
    sources,
    refs,
    extraSystem:
      "The documents are search excerpts (one page each) from the team's library; titles name the file and page. Synthesize across them, and name the source file when you cite a fact.",
  });
});
