import { z } from "zod/v4";

export const organizationTypeFormSchema = z.object({
  id: z.string().optional(),
  code: z
    .string({ error: "Code is required" })
    .min(1, "Code is required")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, digits, and underscores only"),
  name: z.string({ error: "Name is required" }).min(1).max(100),
  level: z.coerce.number().int().min(0, "Level must be 0 or greater"),
  description: z.string().max(2000).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export type OrganizationTypeFormInput = z.infer<typeof organizationTypeFormSchema>;
