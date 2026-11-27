import { z } from "zod";
import { looksSensitive, PROFILE_KEY_LABELS } from "./forms";

/** Request validation shared by the form filler's API routes. */
const rect = z.tuple([z.number(), z.number(), z.number().min(0), z.number().min(0)]);
const text = (max: number) => z.string().max(max);

export const FieldSchema = z.object({
  id: z.string().min(1).max(40),
  page: z.number().int().min(1).max(2000),
  rect,
  type: z.enum(["text", "multiline", "date", "number", "email", "phone", "checkbox", "radio", "choice", "signature", "initials"]),
  label: text(300),
  section: text(200).optional(),
  help: text(1000).optional(),
  profileKey: text(80).nullable().optional(),
  sensitive: z.boolean().optional(),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: text(300), label: text(300), page: z.number().int().optional(), rect: rect.optional() })).max(200).optional(),
  format: text(40).optional(),
  maxLength: z.number().int().min(1).max(10000).optional(),
  comb: z.boolean().optional(),
  acro: text(500).optional(),
  readOnly: z.boolean().optional(),
});

export const ValuesSchema = z.record(
  z.string().max(40),
  z.object({ value: text(20000), source: z.enum(["profile", "ai", "you", "document", "auto"]), confidence: z.number().min(0).max(1).optional(), note: text(500).optional() }),
);

export const ProfileDataSchema = z.object({
  values: z.record(z.string().max(80), text(2000)),
  custom: z.array(z.object({ label: text(200), value: text(2000) })).max(300),
  signature: z.string().max(400_000).nullable().optional(),
  initials: z.string().max(200_000).nullable().optional(),
});

const transform = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
// A 1,600px page JPEG is usually 300-700 KB of base64; 2 MB leaves room for dense scans.
const image = z.string().min(100).max(2_000_000);

export const DetectSchema = z.object({
  pages: z
    .array(
      z.object({
        page: z.number().int().min(1),
        image,
        width: z.number().int().min(50).max(4000),
        height: z.number().int().min(50).max(4000),
        transform,
        candidates: z
          .array(z.object({ id: z.string().max(20), kind: z.enum(["line", "box", "square", "underscore"]), box: z.tuple([z.number(), z.number(), z.number(), z.number()]) }))
          .max(1500)
          .default([]),
      }),
    )
    .min(1)
    .max(30),
});

/** Profiles never keep sensitive answers, even if a client sends them. */
export function scrubProfile<T extends { values: Record<string, string>; custom: { label: string; value: string }[] }>(d: T): T {
  return {
    ...d,
    values: Object.fromEntries(Object.entries(d.values).filter(([k]) => !looksSensitive(PROFILE_KEY_LABELS[k] ?? k))),
    custom: d.custom.filter((c) => !looksSensitive(c.label)),
  };
}
