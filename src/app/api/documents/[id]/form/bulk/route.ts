import { z } from "zod";
import JSZip from "jszip";
import { body, route, HttpError } from "@/lib/http";
import { docAccess, readCurrentPdf } from "@/lib/documents";
import { requireMembership } from "@/lib/billing";
import { buildFilledPdf } from "@/lib/form-pdf";
import { templateFor } from "@/lib/form-store";
import { ValuesSchema } from "@/lib/form-schemas";
import { formatDate, toIsoDate, type FormValues } from "@/lib/forms";
import { logActivity } from "@/lib/activity";

type P = { params: Promise<{ id: string }> };

const Input = z.object({
  rows: z.array(z.record(z.string().max(200), z.string().max(5000))).min(1).max(500),
  /** field id → spreadsheet column */
  mapping: z.record(z.string().max(40), z.string().max(200)),
  /** Answers shared by every copy (e.g. the company's details), and signatures. */
  constants: ValuesSchema.default({}),
  signatures: z.record(z.string().max(40), z.string().max(600_000)).default({}),
  nameColumn: z.string().max(200).optional(),
  flatten: z.boolean().default(true),
});

/** Fills one copy of the form per spreadsheet row and returns them as a ZIP. Day Pass or Pro. */
export const POST = route<P>(async (req, { params }) => {
  const { ctx, doc } = await docAccess((await params).id);
  requireMembership(ctx, "Batch filling");
  const input = await body(req, Input);
  const template = await templateFor(doc);
  if (!template.fields.length) throw new HttpError(400, "This form has no fields to fill.");
  const pdf = await readCurrentPdf(doc);
  const base = doc.name.replace(/\.pdf$/i, "");
  const zip = new JSZip();
  const used = new Set<string>();

  for (const [i, row] of input.rows.entries()) {
    const values: FormValues = { ...input.constants };
    for (const f of template.fields) {
      const col = input.mapping[f.id];
      if (!col || row[col] === undefined) continue;
      let v = row[col].trim();
      if (f.type === "date") {
        const d = toIsoDate(v);
        if (d) v = formatDate(d, f.format);
      }
      values[f.id] = { value: v, source: "document" };
    }
    const out = await buildFilledPdf(pdf, template.fields, values, { flatten: input.flatten, signatures: input.signatures });
    let name = `${base} - ${(input.nameColumn && row[input.nameColumn]?.trim()) || String(i + 1).padStart(3, "0")}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
    while (used.has(name)) name += "_";
    used.add(name);
    zip.file(`${name}.pdf`, out);
  }

  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "form_batch", documentId: doc.id, meta: { copies: input.rows.length } });
  return new Response(Buffer.from(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(base)} - ${input.rows.length} filled.zip"`,
      "Cache-Control": "no-store",
    },
  });
});
