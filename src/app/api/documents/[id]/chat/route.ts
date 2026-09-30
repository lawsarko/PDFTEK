import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { docAccess, pageTexts, readCurrentPdf } from "@/lib/documents";
import { chatResponse, clearHistory, history } from "@/lib/chat";
import { aiConfigured } from "@/lib/ai";
import { rateLimit } from "@/lib/auth";
import { HttpError } from "@/lib/http";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  return json({ messages: history(ctx.workspace.id, ctx.user.id, doc.id) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  clearHistory(ctx.workspace.id, ctx.user.id, doc.id);
  return json({ ok: true });
});

const Input = z.object({ question: z.string().trim().min(1).max(4000), mode: z.enum(["ask", "playbook"]).default("ask") });

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  if (!aiConfigured()) throw new HttpError(503, "AI features need an Anthropic API key. Set ANTHROPIC_API_KEY on the server.", "ai_not_configured");
  rateLimit(`chat:${ctx.user.id}`, ctx.plan === "free" ? 30 : 300, 24 * 3600_000);
  const input = await body(req, Input);
  const pdf = await readCurrentPdf(doc);
  const fallbackText = pageTexts(doc.id).map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
  return chatResponse({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    documentId: doc.id,
    question: input.question,
    sources: [{ kind: "pdf", title: doc.name, pdf, fallbackText }],
    refs: [{ documentId: doc.id, documentName: doc.name }],
    extraSystem: input.mode === "playbook" || /playbook/i.test(input.question) ? `The team's review playbook:\n${ctx.workspace.playbook}` : undefined,
  });
});
