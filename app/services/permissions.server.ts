import type { Prisma } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

export async function listPermissionsPaginated(options: PaginatedQueryOptions) {
  const where = (options.where as Prisma.PermissionWhereInput | undefined) ?? {};
  const orderBy: Prisma.PermissionOrderByWithRelationInput[] = options.orderBy?.length
    ? (options.orderBy as Prisma.PermissionOrderByWithRelationInput[])
    : [{ module: "asc" }, { resource: "asc" }, { action: "asc" }];

  const [items, total] = await Promise.all([
    prisma.permission.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        resource: true,
        action: true,
        module: true,
        description: true,
        createdAt: true,
        _count: { select: { rolePermissions: true } },
      },
    }),
    prisma.permission.count({ where }),
  ]);

  return { items, totalCount: total };
}

export async function getPermissionDetail(permissionId: string) {
  return prisma.permission.findUnique({
    where: { id: permissionId },
    select: {
      id: true,
      resource: true,
      action: true,
      module: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      rolePermissions: {
        select: {
          id: true,
          access: true,
          role: {
            select: {
              id: true,
              name: true,
              scope: true,
              tenant: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
  });
}

export type PermissionInput = {
  resource: string;
  action: string;
  module: string;
  description?: string;
};

export async function createPermission(input: PermissionInput, ctx: TenantServiceContext) {
  const existing = await prisma.permission.findFirst({
    where: { resource: input.resource, action: input.action },
    select: { id: true },
  });
  if (existing) {
    throw new Error(`Permission ${input.resource}:${input.action} already exists`);
  }

  const permission = await prisma.permission.create({
    data: {
      resource: input.resource,
      action: input.action,
      module: input.module,
      description: input.description ?? null,
    },
  });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "permission",
    entityId: permission.id,
    description: `Created permission ${permission.resource}:${permission.action}`,
  });
  return permission;
}

export async function updatePermission(
  permissionId: string,
  input: PermissionInput,
  ctx: TenantServiceContext,
) {
  const permission = await prisma.permission.update({
    where: { id: permissionId },
    data: {
      resource: input.resource,
      action: input.action,
      module: input.module,
      description: input.description ?? null,
    },
  });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "permission",
    entityId: permissionId,
    description: `Updated permission ${permission.resource}:${permission.action}`,
  });
  return permission;
}

export async function deletePermission(permissionId: string, ctx: TenantServiceContext) {
  const existing = await prisma.permission.findUnique({
    where: { id: permissionId },
    select: {
      resource: true,
      action: true,
      _count: { select: { rolePermissions: true } },
    },
  });
  if (!existing) {
    throw new Error("Permission not found");
  }
  if (existing._count.rolePermissions > 0) {
    throw new Error(
      `Cannot delete permission assigned to ${existing._count.rolePermissions} role${existing._count.rolePermissions === 1 ? "" : "s"}. Unassign it first.`,
    );
  }
  await prisma.permission.delete({ where: { id: permissionId } });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "DELETE",
    entityType: "permission",
    entityId: permissionId,
    description: `Deleted permission ${existing.resource}:${existing.action}`,
  });
}
