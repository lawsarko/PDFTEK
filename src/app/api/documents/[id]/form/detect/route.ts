import { body, clientIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { docAccess } from "@/lib/documents";
import { describeAiError } from "@/lib/ai";
import { HttpError } from "@/lib/http";
import { assertPages, detectFields, formAi, labelFields } from "@/lib/form-ai";
import { saveTemplate, templateFor } from "@/lib/form-store";
import { DetectSchema } from "@/lib/form-schemas";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

/**
 * AI reads the form. A fillable PDF keeps its own fields and gets plain-language labels, help and
 * profile links; a flat or scanned form gets its fields found from the page images.
 */
export const POST = route<P>(async (req, { params }) => {
  const { ctx, doc } = await docAccess((await params).id);
  rateLimit(`form-detect:${ctx.user.id}`, 60, 3600_000);
  const { pages } = await body(req, DetectSchema);
  assertPages(pages);
  const onUsage = formAi(ctx, doc.id, clientIp(req));
  const current = await templateFor(doc);
  try {
    const result = current.acro ? await labelFields(current.fields, pages, onUsage) : await detectFields(pages, onUsage);
    if (!result.fields.length) throw new HttpError(422, "No fillable areas were found. You can add fields by hand with “Add field”.");
    const template = saveTemplate(doc, { fields: result.fields, summary: result.summary, acro: current.acro, detectedBy: "ai" });
    logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "form_detected", documentId: doc.id, meta: { fields: result.fields.length } });
    return json({ template });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, describeAiError(e));
  }
});
