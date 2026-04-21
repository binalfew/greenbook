import type { Prisma } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

export async function listRolesPaginated(
  tenantId: string | undefined,
  options: PaginatedQueryOptions,
) {
  const where: Prisma.RoleWhereInput = {
    ...(tenantId ? { OR: [{ tenantId }, { scope: "GLOBAL" }] } : {}),
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

export async function getRoleDetail(roleId: string) {
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

export async function createRole(input: RoleInput, ctx: TenantServiceContext) {
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
  const role = await prisma.role.update({
    where: { id: roleId },
    data: {
      name: input.name,
      description: input.description,
      scope: input.scope,
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
    select: { name: true },
  });
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
