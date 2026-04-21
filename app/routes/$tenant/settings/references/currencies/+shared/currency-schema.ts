import { z } from "zod/v4";

export const currencyFormSchema = z.object({
  id: z.string().optional(),
  code: z.string({ error: "Code is required" }).length(3, "Code must be 3 characters (ISO 4217)"),
  name: z.string({ error: "Name is required" }).min(1).max(100),
  symbol: z.string().optional().default(""),
  decimalDigits: z.coerce.number().int().min(0).max(10).default(2),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type CurrencyFormInput = z.infer<typeof currencyFormSchema>;
