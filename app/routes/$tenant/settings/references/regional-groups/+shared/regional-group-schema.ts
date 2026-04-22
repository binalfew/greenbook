import { z } from "zod/v4";

export const regionalGroupFormSchema = z.object({
  id: z.string().optional(),
  code: z
    .string({ error: "Code is required" })
    .min(1, "Code is required")
    .max(20)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, digits, and underscores only"),
  name: z.string({ error: "Name is required" }).min(1).max(100),
  description: z.string().max(2000).optional(),
});

export type RegionalGroupFormInput = z.infer<typeof regionalGroupFormSchema>;
