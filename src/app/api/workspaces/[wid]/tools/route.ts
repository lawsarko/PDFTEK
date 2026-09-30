import { z } from "zod";
import { body, json, route, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { addVersion, assertCanEdit, createDocument, getDocument, readCurrentPdf, serializeDoc } from "@/lib/documents";
import { mergePdfs, optimize, pageNumbers, parseRanges, rebuildPages, setMetadata, watermark } from "@/lib/pdf";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ wid: string }> };

const Input = z.discriminatedUnion("op", [
  z.object({ op: z.literal("merge"), docIds: z.array(z.string()).min(2).max(50), name: z.string().trim().min(1).max(200) }),
  z.object({ op: z.literal("split"), docId: z.string(), ranges: z.array(z.string().max(200)).min(1).max(50) }),
  z.object({ op: z.literal("extract"), docId: z.string(), ranges: z.string().max(500), name: z.string().trim().max(200).optional() }),
  z.object({ op: z.literal("delete_pages"), docId: z.string(), ranges: z.string().max(500) }),
  z.object({ op: z.literal("organize"), docId: z.string(), pages: z.array(z.object({ index: z.number().int().min(0), rotate: z.number().int().optional() })).min(1).max(5000) }),
  z.object({ op: z.literal("rotate"), docId: z.string(), ranges: z.string().max(500), degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
  z.object({ op: z.literal("watermark"), docId: z.string(), text: z.string().trim().min(1).max(60), opacity: z.number().min(0.05).max(0.9).default(0.15), asCopy: z.boolean().default(true) }),
  z.object({
    op: z.literal("page_numbers"),
    docId: z.string(),
    position: z.enum(["bottom-center", "bottom-right", "top-right"]),
    format: z.string().max(40).default("Page {n} of {total}"),
    start: z.number().int().min(0).max(100000).default(1),
  }),
  z.object({ op: z.literal("optimize"), docId: z.string() }),
  z.object({ op: z.literal("metadata"), docId: z.string(), title: z.string().max(300), author: z.string().max(200), subject: z.string().max(300) }),
]);

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid);
  const input = await body(req, Input);
  const base = (n: string) => n.replace(/\.pdf$/i, "");

  const newDoc = async (name: string, pdf: Buffer) =>
    serializeDoc(await createDocument({ workspaceId: wid, userId: ctx.user.id, name: name.endsWith(".pdf") ? name : `${name}.pdf`, data: pdf }));

  const newVersion = async (docId: string, pdf: Buffer, note: string) => {
    const doc = getDocument(ctx, docId);
    assertCanEdit(doc, ctx.user.id);
    await addVersion({ doc, userId: ctx.user.id, pdf, note });
    return serializeDoc(getDocument(ctx, docId));
  };

  switch (input.op) {
    case "merge": {
      const docs = input.docIds.map((d) => getDocument(ctx, d));
      const pdf = await mergePdfs(await Promise.all(docs.map(readCurrentPdf)));
      const created = await newDoc(input.name, pdf);
      logActivity({ workspaceId: wid, userId: ctx.user.id, action: "merged", documentId: created.id, meta: { count: docs.length } });
      return json({ documents: [created] });
    }
    case "split": {
      const doc = getDocument(ctx, input.docId);
      const src = await readCurrentPdf(doc);
      const out = [];
      for (const [i, r] of input.ranges.entries()) {
        const pages = parseRanges(r, doc.page_count);
        out.push(await newDoc(`${base(doc.name)} — part ${i + 1} (p${r.replace(/\s/g, "")})`, await rebuildPages(src, pages.map((index) => ({ index })))));
      }
      return json({ documents: out });
    }
    case "extract": {
      const doc = getDocument(ctx, input.docId);
      const pages = parseRanges(input.ranges, doc.page_count);
      const pdf = await rebuildPages(await readCurrentPdf(doc), pages.map((index) => ({ index })));
      return json({ documents: [await newDoc(input.name || `${base(doc.name)} (pages ${input.ranges})`, pdf)] });
    }
    case "delete_pages": {
      const doc = getDocument(ctx, input.docId);
      const remove = new Set(parseRanges(input.ranges, doc.page_count));
      const keep = [...Array(doc.page_count).keys()].filter((i) => !remove.has(i));
      if (!keep.length) throw badRequest("You can't delete every page.");
      const pdf = await rebuildPages(await readCurrentPdf(doc), keep.map((index) => ({ index })));
      return json({ documents: [await newVersion(doc.id, pdf, `Deleted pages ${input.ranges}`)] });
    }
    case "organize": {
      const doc = getDocument(ctx, input.docId);
      if (input.pages.some((p) => p.index >= doc.page_count)) throw badRequest("Page list is out of date; reload and try again.");
      const pdf = await rebuildPages(await readCurrentPdf(doc), input.pages);
      return json({ documents: [await newVersion(doc.id, pdf, "Reorganized pages")] });
    }
    case "rotate": {
      const doc = getDocument(ctx, input.docId);
      const targets = new Set(parseRanges(input.ranges, doc.page_count));
      const pdf = await rebuildPages(
        await readCurrentPdf(doc),
        [...Array(doc.page_count).keys()].map((index) => ({ index, rotate: targets.has(index) ? input.degrees : 0 })),
      );
      return json({ documents: [await newVersion(doc.id, pdf, `Rotated pages ${input.ranges}`)] });
    }
    case "watermark": {
      const doc = getDocument(ctx, input.docId);
      const pdf = await watermark(await readCurrentPdf(doc), input.text, input.opacity);
      if (input.asCopy) return json({ documents: [await newDoc(`${base(doc.name)} (${input.text})`, pdf)] });
      return json({ documents: [await newVersion(doc.id, pdf, `Watermark “${input.text}”`)] });
    }
    case "page_numbers": {
      const doc = getDocument(ctx, input.docId);
      const pdf = await pageNumbers(await readCurrentPdf(doc), input);
      return json({ documents: [await newVersion(doc.id, pdf, "Added page numbers")] });
    }
    case "optimize": {
      const doc = getDocument(ctx, input.docId);
      const before = doc.size;
      const pdf = await optimize(await readCurrentPdf(doc));
      if (pdf.length >= before) return json({ documents: [serializeDoc(doc)], message: "This file is already well optimized." });
      return json({ documents: [await newVersion(doc.id, pdf, `Optimized (${Math.round((1 - pdf.length / before) * 100)}% smaller)`)] });
    }
    case "metadata": {
      const doc = getDocument(ctx, input.docId);
      const pdf = await setMetadata(await readCurrentPdf(doc), input);
      return json({ documents: [await newVersion(doc.id, pdf, "Updated properties")] });
    }
  }
});
