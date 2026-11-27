import { z } from "zod/v4";
import { RESERVED_SLUG_MESSAGE, isReservedSlug } from "~/utils/reserved-slugs";

const slugField = z
  .string({ error: "Slug is required" })
  .min(1, "Slug is required")
  .max(50, "Slug must be at most 50 characters")
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    "Slug must be lowercase alphanumeric with hyphens only, cannot start or end with a hyphen",
  )
  .refine((val) => !isReservedSlug(val), RESERVED_SLUG_MESSAGE);

export const createTenantSchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .min(1, "Name is required")
    .max(200, "Name must be at most 200 characters"),
  slug: slugField,
  email: z.email("Valid email is required"),
  phone: z.string({ error: "Phone is required" }).min(1, "Phone is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  logoUrl: z.string().optional(),
  brandTheme: z.string().optional(),
  // Optional: existing user to bootstrap as the new tenant's admin. Empty
  // string from the form means "create the tenant without an initial admin"
  // (admins can be assigned later via the user-edit form).
  initialAdminUserId: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const updateTenantSchema = createTenantSchema.partial();
