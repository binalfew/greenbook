import { z } from "zod/v4";

const emailField = z.email({
  error: (issue) =>
    issue.input === undefined ? "Email is required" : "Enter a valid email address",
});
const firstNameField = z
  .string({ error: "First name is required" })
  .min(1, "First name is required")
  .max(100);
const lastNameField = z
  .string({ error: "Last name is required" })
  .min(1, "Last name is required")
  .max(100);

// Empty string from the form means "no tenant" (regular user). Convert to null
// so the service layer sees the explicit-null contract instead of "".
const tenantIdField = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

export const createUserSchema = z.object({
  firstName: firstNameField,
  lastName: lastNameField,
  email: emailField,
  password: z
    .string({ error: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number"),
  userStatusId: z.string().optional(),
  // Optional override: only honoured when the actor is a global admin.
  // Empty/undefined → fall back to actor's own tenant (existing behaviour).
  tenantId: tenantIdField,
  roleIds: z.array(z.string()).optional(),
});

export const updateUserSchema = z.object({
  firstName: firstNameField,
  lastName: lastNameField,
  email: emailField,
  userStatusId: z.string().optional(),
  // Optional override: only honoured when the actor is a global admin.
  // Empty string → make the user tenantless (regular user).
  tenantId: tenantIdField,
});

export const assignRolesSchema = z.object({
  roleIds: z.array(z.string()).optional(),
});

export const createRoleSchema = z.object({
  name: z.string({ error: "Name is required" }).min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  scope: z.enum(["GLOBAL", "TENANT", "EVENT"]).default("TENANT"),
});

export const updateRoleSchema = createRoleSchema;

export const rolePermissionsSchema = z.object({
  permissionIds: z.array(z.string()).optional(),
});

export const createPermissionSchema = z.object({
  resource: z.string({ error: "Resource is required" }).min(1, "Resource is required").max(100),
  action: z.string({ error: "Action is required" }).min(1, "Action is required").max(100),
  module: z.string().min(1, "Module is required").max(50).default("system"),
  description: z.string().max(500).optional(),
});

export const updatePermissionSchema = createPermissionSchema;
