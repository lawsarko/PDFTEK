import { z } from "zod";

/** Body of "save template" / "update template" requests. */
export const TemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).default(""),
  sequential: z.boolean().default(false),
  roles: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        label: z.string().trim().min(1).max(60),
        name: z.string().trim().max(100).optional(),
        email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).optional(),
      }),
    )
    .min(1)
    .max(10),
  fields: z
    .array(
      z.object({
        roleKey: z.string().max(40),
        page: z.number().int().min(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0.01).max(1),
        h: z.number().min(0.005).max(1),
        kind: z.enum(["signature", "initials", "date", "name", "text"]),
      }),
    )
    .max(500),
});
