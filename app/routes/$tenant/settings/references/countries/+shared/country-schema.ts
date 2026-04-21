import { z } from "zod/v4";

export const countryFormSchema = z.object({
  id: z.string().optional(),
  code: z
    .string({ error: "Code is required" })
    .length(2, "Code must be 2 characters (ISO 3166-1 alpha-2)"),
  name: z.string({ error: "Name is required" }).min(1).max(100),
  alpha3: z.string().optional().default(""),
  numericCode: z.string().optional().default(""),
  phoneCode: z.string().optional().default(""),
  flag: z.string().optional().default(""),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type CountryFormInput = z.infer<typeof countryFormSchema>;
