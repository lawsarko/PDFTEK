import { z } from "zod";
import { assertAiCredits, chargeAi } from "@/lib/billing";
import { body, json, route } from "@/lib/http";
import { complete } from "@/lib/ai";
import { docAccess } from "@/lib/documents";

const Input = z.object({
  a: z.object({ documentId: z.string(), label: z.string().max(200) }),
  b: z.object({ documentId: z.string(), label: z.string().max(200) }),
  diff: z.string().max(400_000),
});

/** Summarizes material differences between two documents from a precomputed redline. */
export const POST = route(async (req) => {
  const input = await body(req, Input);
  const { ctx } = await docAccess(input.a.documentId);
  await docAccess(input.b.documentId);
  assertAiCredits(ctx);
  const summary = await complete({
    onUsage: (model, usage) => chargeAi(ctx, model, usage, "AI compare summary"),
    system:
      "You review redlines between two versions of a business document. Report only material changes (obligations, money, dates, parties, liability, termination, scope, governing law). Group by section. For each: what changed, and who it favors. Skip formatting and trivial wording changes. Plain text with short bullets; bold section names.",
    prompt: `Original: ${input.a.label}\nRevised: ${input.b.label}\n\nRedline (insertions as {+text+}, deletions as [-text-], with page markers):\n\n${input.diff}`,
  });
  return json({ summary });
});
