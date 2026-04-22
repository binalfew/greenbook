import { z } from "zod/v4";

export const memberStateFormSchema = z.object({
  id: z.string().optional(),
  fullName: z.string({ error: "Full name is required" }).min(1).max(255),
  abbreviation: z
    .string({ error: "Abbreviation is required" })
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9]+$/, "Use uppercase letters and digits only"),
  dateJoined: z
    .string({ error: "Date joined is required" })
    .min(1, "Date joined is required")
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" }),
  isActive: z.boolean().default(true),
  predecessorOrg: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || v === "OAU" || v === "AU", {
      message: "Must be OAU, AU, or blank",
    }),
  notes: z.string().max(5000).optional(),
  regionIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (!v) return [];
      return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
    }),
});

export type MemberStateFormInput = z.infer<typeof memberStateFormSchema>;
