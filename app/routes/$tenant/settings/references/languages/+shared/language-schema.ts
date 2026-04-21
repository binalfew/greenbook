import { z } from "zod/v4";

export const languageFormSchema = z.object({
  id: z.string().optional(),
  code: z
    .string({ error: "Code is required" })
    .min(2, "Code must be at least 2 characters")
    .max(10),
  name: z.string({ error: "Name is required" }).min(1).max(100),
  nativeName: z.string().optional().default(""),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type LanguageFormInput = z.infer<typeof languageFormSchema>;
