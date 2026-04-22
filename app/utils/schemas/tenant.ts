import { z } from "zod/v4";

const SUBSCRIPTION_PLANS = ["free", "starter", "professional", "enterprise"] as const;

/**
 * Slugs that would collide with top-level app routes if a tenant picked them.
 * Keep this list in sync with the directories under `app/routes/` that live at
 * the root (i.e. not under `$tenant/`).
 */
const RESERVED_SLUGS = new Set([
  "api",
  "login",
  "logout",
  "signup",
  "forgot-password",
  "reset-password",
  "change-expired-password",
  "2fa-verify",
  "2fa-setup",
  "2fa-recovery",
  "accept-invite",
  "verify",
  "onboarding",
  "resources",
  "home",
  "offline",
  "directory",
  "public",
  "people",
  "organizations",
  "positions",
]);

const slugField = z
  .string({ error: "Slug is required" })
  .min(1, "Slug is required")
  .max(50, "Slug must be at most 50 characters")
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    "Slug must be lowercase alphanumeric with hyphens only, cannot start or end with a hyphen",
  )
  .refine((val) => !RESERVED_SLUGS.has(val), "This slug is reserved and cannot be used");

export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);

export const PLAN_OPTIONS = SUBSCRIPTION_PLANS.map((p) => ({
  value: p,
  label: p.charAt(0).toUpperCase() + p.slice(1),
}));

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
  subscriptionPlan: subscriptionPlanSchema.optional(),
  logoUrl: z.string().optional(),
  brandTheme: z.string().optional(),
});

export const updateTenantSchema = createTenantSchema.partial();
