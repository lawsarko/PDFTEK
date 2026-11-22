import { z } from "zod";
import { body, route, badRequest } from "@/lib/http";
import { createDocument, docAccess, readCurrentPdf, serializeDoc } from "@/lib/documents";
import { assertAiCredits, chargeAi } from "@/lib/billing";
import { aiConfigured } from "@/lib/ai";
import { heavy } from "@/lib/heavy";
import { logActivity } from "@/lib/activity";
import { aiTranslator, translatePdf, TRANSLATE_MAX_PAGES } from "@/lib/pdf-translate";
import { translateLanguage } from "@/lib/translate-languages";

type P = { params: Promise<{ id: string }> };

const Input = z.object({ language: z.string().min(2).max(10) });

/**
 * Translate PDF, keeping the layout. Streams progress as newline-delimited JSON:
 *   {"type":"progress","stage":"translating","done":3,"total":40}
 *   {"type":"done","document":{…}}  or  {"type":"error","message":"…"}
 * The translated copy is saved as a new document; the original is unchanged.
 */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const { ctx, doc } = await docAccess(id);
  const { language } = await body(req, Input);
  const lang = translateLanguage(language);
  if (!lang) throw badRequest("Choose a language to translate into.");
  if (doc.page_count > TRANSLATE_MAX_PAGES) throw badRequest(`Translate PDF handles up to ${TRANSLATE_MAX_PAGES} pages at a time. Split the document first (Organize → Split).`);
  const fake = process.env.PDFTEK_FAKE_AI === "1" && process.env.NODE_ENV !== "production";
  if (!fake) {
    if (!aiConfigured()) throw badRequest("Translation needs AI, which isn't set up on this server (ANTHROPIC_API_KEY).");
    assertAiCredits(ctx);
  }
  const source = await readCurrentPdf(doc);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* the browser went away; the job still finishes and the document is saved */
        }
      };
      let credits = 0;
      try {
        const out = await translatePdf(source, {
          language: lang,
          exclusive: heavy,
          translate: aiTranslator(lang, (model, usage) => {
            credits += chargeAi(ctx, model, usage, `Translate PDF: ${doc.name} → ${lang.english}`);
          }),
          onProgress: (p) => send({ type: "progress", ...p }),
        });
        const base = doc.name.replace(/\.pdf$/i, "");
        const created = await createDocument({
          workspaceId: ctx.workspace.id,
          userId: ctx.user.id,
          name: `${base} (${lang.english}).pdf`,
          data: out.pdf,
          tags: ["translated", lang.english.toLowerCase()],
        });
        logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "translated", documentId: created.id, meta: { from: doc.name, language: lang.english, pages: out.pages, credits } });
        send({ type: "done", document: serializeDoc(created), credits, pages: out.pages });
      } catch (e) {
        console.error("[pdftek] translate failed", e);
        const message = e instanceof Error && "status" in e ? e.message : "The translation couldn't be completed. Please try again.";
        send({ type: "error", message, credits });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
