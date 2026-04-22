import { z } from "zod/v4";

export const positionTypeFormSchema = z.object({
  id: z.string().optional(),
  code: z
    .string({ error: "Code is required" })
    .min(1, "Code is required")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, digits, and underscores only"),
  name: z.string({ error: "Name is required" }).min(1).max(100),
  hierarchyLevel: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), {
      message: "Hierarchy level must be 0 or greater",
    }),
  description: z.string().max(2000).optional(),
});

export type PositionTypeFormInput = z.infer<typeof positionTypeFormSchema>;
