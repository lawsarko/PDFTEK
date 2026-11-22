import { z } from "zod";
import { badRequest, body, json, route } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { assertBatch, entitlements } from "@/lib/billing";
import { createDocument, serializeDoc } from "@/lib/documents";
import { download, isProvider, PROVIDER_NAME } from "@/lib/cloud";

type P = { params: Promise<{ provider: string }> };

const Input = z.object({ workspaceId: z.string(), ids: z.array(z.string().min(1).max(500)).min(1).max(50) });

/** Copies files from Google Drive, Dropbox or OneDrive into the workspace library. */
export const POST = route<P>(async (req, { params }) => {
  const { provider } = await params;
  if (!isProvider(provider)) throw badRequest("Unknown service.");
  const input = await body(req, Input);
  const ctx = await requireMember(input.workspaceId);
  if (input.ids.length > 1) assertBatch(ctx, input.ids.length);
  const maxBytes = entitlements(ctx, req).maxFileMb * 1024 * 1024;
  const documents = [];
  const errors: { id: string; error: string }[] = [];
  for (const fileId of input.ids) {
    try {
      const f = await download(ctx.user.id, provider, fileId, maxBytes);
      const doc = await createDocument({ workspaceId: ctx.workspace.id, userId: ctx.user.id, name: f.name, data: f.data, tags: [PROVIDER_NAME[provider].toLowerCase()] });
      documents.push(serializeDoc(doc));
    } catch (e) {
      // Sign-in problems apply to every file: stop and say so once.
      if (e instanceof Error && "code" in e && (e as { code?: string }).code === "cloud_not_connected") throw e;
      errors.push({ id: fileId, error: e instanceof Error ? e.message : "Couldn't import this file." });
    }
  }
  return json({ documents, errors });
});
