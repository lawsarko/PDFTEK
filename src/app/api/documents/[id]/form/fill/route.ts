import { z } from "zod";
import { body, clientIp, json, route, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/auth";
import { docAccess, pageTexts } from "@/lib/documents";
import { describeAiError } from "@/lib/ai";
import { formAi, smartFill } from "@/lib/form-ai";
import { getProfile, templateFor } from "@/lib/form-store";
import { ValuesSchema } from "@/lib/form-schemas";

type P = { params: Promise<{ id: string }> };

const Input = z.object({
  profileId: z.string().max(40).nullable(),
  instructions: z.string().max(4000).default(""),
  sourceIds: z.array(z.string().max(40)).max(5).default([]),
  current: ValuesSchema.default({}),
  /** Limit the fill to these fields (e.g. one section); all fields when absent. */
  fieldIds: z.array(z.string().max(40)).max(2000).optional(),
});

/** AI fills the form from the profile, the person's instructions and supporting documents. */
export const POST = route<P>(async (req, { params }) => {
  const { ctx, doc } = await docAccess((await params).id);
  rateLimit(`form-fill:${ctx.user.id}`, 120, 3600_000);
  const input = await body(req, Input);
  const template = await templateFor(doc);
  if (!template.fields.length) throw new HttpError(400, "This form has no fields yet. Let AI read it first, or add fields by hand.");
  const profile = input.profileId ? getProfile(ctx.user.id, input.profileId).data : null;

  // Supporting documents must be in the same workspace (docAccess checks membership).
  const sources = [];
  for (const sid of input.sourceIds) {
    const { doc: src } = await docAccess(sid);
    const text = pageTexts(src.id).map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
    sources.push({ title: src.name, text: text || "(This document has no readable text. Run OCR on it first.)" });
  }

  const onUsage = formAi(ctx, doc.id, clientIp(req));
  const fields = input.fieldIds ? template.fields.filter((f) => input.fieldIds!.includes(f.id)) : template.fields;
  try {
    const result = await smartFill({ fields, profile, current: input.current, instructions: input.instructions, sources, summary: template.summary, onUsage });
    return json(result);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, describeAiError(e));
  }
});
