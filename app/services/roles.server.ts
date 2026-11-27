import type { Prisma } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

export async function listRolesPaginated(
  _tenantId: string | undefined,
  options: PaginatedQueryOptions,
) {
  // Roles are platform-global (4 canonical rows). The tenantId argument is
  // retained for callsite parity with other paginated lists but is no longer
  // used to scope the result — every viewer sees the same role catalog.
  const where: Prisma.RoleWhereInput = {
    ...(options.where as Prisma.RoleWhereInput | undefined),
  };
  const orderBy: Prisma.RoleOrderByWithRelationInput[] = options.orderBy?.length
    ? (options.orderBy as Prisma.RoleOrderByWithRelationInput[])
    : [{ scope: "asc" }, { name: "asc" }];

  const [items, total] = await Promise.all([
    prisma.role.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        scope: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, slug: true } },
        _count: { select: { rolePermissions: true, userRoles: true } },
      },
    }),
    prisma.role.count({ where }),
  ]);

  return { items, totalCount: total };
}

/**
 * `membersInTenantId` limits the listed role holders to one tenant. Roles are
 * platform-wide rows, so without it the holder list spans every tenant.
 */
export async function getRoleDetail(roleId: string, membersInTenantId?: string) {
  return prisma.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      name: true,
      description: true,
      scope: true,
      tenantId: true,
      createdAt: true,
      updatedAt: true,
      tenant: { select: { id: true, name: true, slug: true } },
      rolePermissions: {
        select: {
          id: true,
          access: true,
          permission: {
            select: {
              id: true,
              resource: true,
              action: true,
              module: true,
              description: true,
            },
          },
        },
      },
      userRoles: {
        where: {
          user: { deletedAt: null, ...(membersInTenantId && { tenantId: membersInTenantId }) },
        },
        select: {
          id: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
}

export type RoleInput = {
  name: string;
  description?: string;
  scope: "GLOBAL" | "TENANT" | "EVENT";
};

/** A role change refused for a reason the admin can act on. */
export class RoleGuardError extends Error {}

// Access checks look these roles up by name (`admin` at GLOBAL scope is the
// platform admin), so their name and scope are part of the security model.
export const BUILT_IN_ROLE_NAMES = ["admin", "manager", "focal", "user"];

function isBuiltIn(role: { name: string; tenantId: string | null }): boolean {
  return role.tenantId === null && BUILT_IN_ROLE_NAMES.includes(role.name);
}

// `@@unique([tenantId, name])` does not stop two tenant-less roles sharing a
// name (Postgres treats NULLs as distinct), and a second "admin" there would
// be a second platform-admin role. Built-in names are refused everywhere so a
// look-alike can't be created inside a tenant either.
async function assertRoleNameAvailable(name: string, tenantId: string | null, exceptId?: string) {
  const wanted = name.trim().toLowerCase();
  if (BUILT_IN_ROLE_NAMES.includes(wanted)) {
    throw new RoleGuardError(`"${name}" is a built-in role name. Choose another name.`);
  }
  if (tenantId !== null) return;
  const clash = await prisma.role.findFirst({
    where: {
      tenantId: null,
      name: { equals: name.trim(), mode: "insensitive" },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (clash) throw new RoleGuardError(`A role named "${name}" already exists.`);
}

export async function createRole(input: RoleInput, ctx: TenantServiceContext) {
  await assertRoleNameAvailable(input.name, input.scope === "GLOBAL" ? null : ctx.tenantId);
  const role = await prisma.role.create({
    data: {
      name: input.name,
      description: input.description,
      scope: input.scope,
      tenantId: input.scope === "GLOBAL" ? null : ctx.tenantId,
    },
  });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "role",
    entityId: role.id,
    description: `Created role ${role.name}`,
  });
  return role;
}

export async function updateRole(roleId: string, input: RoleInput, ctx: TenantServiceContext) {
  const existing = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true, scope: true, tenantId: true },
  });
  if (!existing) throw new RoleGuardError("Role not found.");

  if (isBuiltIn(existing)) {
    if (input.name !== existing.name || input.scope !== existing.scope) {
      throw new RoleGuardError(
        `"${existing.name}" is a built-in role. Its name and scope cannot be changed.`,
      );
    }
  } else {
    // A role made GLOBAL leaves its tenant, so its name must be free there.
    const tenantId = input.scope === "GLOBAL" ? null : existing.tenantId;
    await assertRoleNameAvailable(input.name, tenantId, roleId);
  }

  const role = await prisma.role.update({
    where: { id: roleId },
    data: {
      name: input.name,
      description: input.description,
      scope: input.scope,
      ...(input.scope === "GLOBAL" && { tenantId: null }),
    },
  });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "role",
    entityId: roleId,
    description: `Updated role ${role.name}`,
  });
  return role;
}

export async function deleteRole(roleId: string, ctx: TenantServiceContext) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true, tenantId: true },
  });
  if (role && isBuiltIn(role)) {
    throw new RoleGuardError(`"${role.name}" is a built-in role and cannot be deleted.`);
  }
  await prisma.role.delete({ where: { id: roleId } });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "DELETE",
    entityType: "role",
    entityId: roleId,
    description: `Deleted role ${role?.name ?? roleId}`,
  });
}

export async function replaceRolePermissions(
  roleId: string,
  permissionIds: string[],
  ctx: TenantServiceContext,
) {
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }
  });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "role-permissions",
    entityId: roleId,
    description: `Replaced permission assignments (${permissionIds.length} permission${permissionIds.length === 1 ? "" : "s"})`,
  });
}
