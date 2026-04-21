import { z } from "zod/v4";

const emailField = z.email("Valid email is required");
const nameField = z.string().min(1, "Required").max(100);

export const createUserSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number"),
  userStatusId: z.string().optional(),
  roleIds: z.array(z.string()).optional(),
});

export const updateUserSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  userStatusId: z.string().optional(),
});

export const assignRolesSchema = z.object({
  roleIds: z.array(z.string()).optional(),
});

export const inviteUserSchema = z.object({
  email: emailField,
  firstName: nameField.optional(),
  lastName: nameField.optional(),
  roleIds: z.array(z.string()).optional(),
});

export const createRoleSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  scope: z.enum(["GLOBAL", "TENANT", "EVENT"]).default("TENANT"),
});

export const updateRoleSchema = createRoleSchema;

export const rolePermissionsSchema = z.object({
  permissionIds: z.array(z.string()).optional(),
});

export const createPermissionSchema = z.object({
  resource: z.string().min(1, "Resource is required").max(100),
  action: z.string().min(1, "Action is required").max(100),
  module: z.string().min(1, "Module is required").max(50).default("system"),
  description: z.string().max(500).optional(),
});

export const updatePermissionSchema = createPermissionSchema;
