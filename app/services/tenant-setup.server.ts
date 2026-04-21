import { RoleScope } from "~/generated/prisma/client";
import { prisma } from "~/utils/db/db.server";

/**
 * The permission set each new tenant's admin role inherits. Mirrors the baseline
 * permissions created by `prisma/seed.ts` — a new tenant's admin can manage
 * users, roles, permissions, and audit within their own tenant. Keep in sync
 * with the seed's `UNIQUE_PERMISSIONS` list.
 */
const TENANT_ADMIN_PERMISSIONS = [
  { resource: "user", action: "read" },
  { resource: "user", action: "create" },
  { resource: "user", action: "update" },
  { resource: "user", action: "delete" },
  { resource: "role", action: "read" },
  { resource: "role", action: "create" },
  { resource: "role", action: "update" },
  { resource: "role", action: "delete" },
  { resource: "permission", action: "read" },
  { resource: "permission", action: "create" },
  { resource: "permission", action: "update" },
  { resource: "permission", action: "delete" },
  { resource: "settings", action: "read" },
  { resource: "settings", action: "write" },
  { resource: "feature-flag", action: "read" },
  { resource: "feature-flag", action: "write" },
  { resource: "two-factor", action: "read" },
  { resource: "two-factor", action: "update" },
];

const TENANT_USER_PERMISSIONS: Array<{ resource: string; action: string; access: "own" | "any" }> =
  [
    { resource: "user", action: "read", access: "own" },
    { resource: "user", action: "update", access: "own" },
  ];

export type BootstrapResult = {
  adminRoleId: string;
  userRoleId: string;
};

/**
 * Initialize a freshly-created tenant: create the tenant-scoped `admin` and
 * `user` roles, wire up permissions, and attach the initial admin user to the
 * admin role.
 *
 * Assumes the required `Permission` rows already exist (seeded at install
 * time). Missing permissions are skipped silently — the role gains whatever is
 * available.
 */
export async function bootstrapNewTenant(args: {
  tenantId: string;
  initialAdminUserId: string;
}): Promise<BootstrapResult> {
  const { tenantId, initialAdminUserId } = args;

  const adminRole = await prisma.role.create({
    data: {
      tenantId,
      name: "admin",
      scope: RoleScope.TENANT,
      description: "Tenant administrator — full access within the tenant",
    },
  });

  const userRole = await prisma.role.create({
    data: {
      tenantId,
      name: "user",
      scope: RoleScope.TENANT,
      description: "Default tenant user — baseline permissions",
    },
  });

  // Admin role: grant every listed permission with access "any".
  for (const { resource, action } of TENANT_ADMIN_PERMISSIONS) {
    const perm = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
      select: { id: true },
    });
    if (perm) {
      await prisma.rolePermission.create({
        data: { roleId: adminRole.id, permissionId: perm.id, access: "any" },
      });
    }
  }

  // User role: self-scoped permissions only.
  for (const { resource, action, access } of TENANT_USER_PERMISSIONS) {
    const perm = await prisma.permission.findUnique({
      where: { resource_action: { resource, action } },
      select: { id: true },
    });
    if (perm) {
      await prisma.rolePermission.create({
        data: { roleId: userRole.id, permissionId: perm.id, access },
      });
    }
  }

  // Attach the initial admin to the tenant admin role.
  await prisma.userRole.create({
    data: { userId: initialAdminUserId, roleId: adminRole.id },
  });

  return { adminRoleId: adminRole.id, userRoleId: userRole.id };
}
