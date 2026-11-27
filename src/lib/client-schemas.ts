import { z } from "zod";

/** Input shapes shared by the Clients API routes. */

export const ClientFields = z.object({
  kind: z.enum(["individual", "couple", "business"]).default("individual"),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(40).optional(),
  spouseName: z.string().trim().max(120).optional(),
  spouseEmail: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).optional(),
  company: z.string().trim().max(160).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  assignedTo: z.string().nullable().optional(),
  notes: z.string().max(4000).optional(),
});

const Accept = z.enum(["any", "pdf", "image", "office"]);
export const RequestSpec = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).default(""),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  items: z.array(z.object({ label: z.string().trim().min(1).max(200), note: z.string().trim().max(300).optional(), required: z.boolean().optional(), accept: Accept.optional() })).min(1).max(40),
  verify: z.enum(["none", "email", "code"]).default("none"),
  expiresInDays: z.number().int().min(1).max(365).default(60),
  autoRemind: z.boolean().default(true),
  packet: z.boolean().default(false),
  year: z.number().int().min(1990).max(2100).nullable().optional(),
});
