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

/** Roles the initial user of a new tenant can be given. */
export const INITIAL_USER_ROLES = ["focal", "manager"] as const;
export type InitialUserRole = (typeof INITIAL_USER_ROLES)[number];

const tenantFieldsSchema = z.object({
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
  // Optional: an existing user who belongs to no tenant, moved into the new
  // tenant as its first focal person or manager. An empty string from the
  // form means "no initial user".
  initialUserId: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  initialUserRole: z.enum(INITIAL_USER_ROLES, "Choose focal person or manager").optional(),
});

export const createTenantSchema = tenantFieldsSchema.superRefine((value, ctx) => {
  if (value.initialUserId && !value.initialUserRole) {
    ctx.addIssue({
      code: "custom",
      path: ["initialUserRole"],
      message: "Choose a role for the initial user",
    });
  }
});

export const updateTenantSchema = tenantFieldsSchema
  .omit({ initialUserId: true, initialUserRole: true })
  .partial();
