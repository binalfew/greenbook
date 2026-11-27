import { hash } from "bcryptjs";
import { Prisma, RoleScope } from "~/generated/prisma/client";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";

export async function getUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      tenantId: true,
      userRoles: {
        select: {
          eventId: true,
          role: {
            select: {
              id: true,
              name: true,
              scope: true,
              rolePermissions: {
                select: {
                  access: true,
                  permission: { select: { resource: true, action: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function listUsersPaginated(
  tenantId: string | undefined,
  options: PaginatedQueryOptions,
) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(tenantId ? { tenantId } : {}),
    ...(options.where as Prisma.UserWhereInput | undefined),
  };
  const orderBy: Prisma.UserOrderByWithRelationInput[] = options.orderBy?.length
    ? (options.orderBy as Prisma.UserOrderByWithRelationInput[])
    : [{ createdAt: "desc" }];

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        lastLoginAt: true,
        createdAt: true,
        userStatus: { select: { code: true, name: true } },
        tenant: { select: { name: true, slug: true } },
        userRoles: {
          select: { id: true, role: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { items, totalCount: total };
}

export async function getUserDetail(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      tenantId: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      userStatus: { select: { id: true, code: true, name: true } },
      tenant: { select: { id: true, name: true, slug: true } },
      userRoles: {
        select: {
          id: true,
          role: { select: { id: true, name: true, scope: true } },
        },
      },
    },
  });
}

/** Refused because another live user already holds the email. */
export class EmailTakenError extends Error {
  constructor() {
    super("A user with this email already exists");
  }
}

// `User.email` is unique across the whole system, not per tenant. Checking
// first turns a clash into an error the form can show on the field.
async function assertEmailAvailable(email: string, exceptUserId?: string) {
  const holder = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(exceptUserId && { id: { not: exceptUserId } }),
    },
    select: { id: true },
  });
  if (holder) throw new EmailTakenError();
}

// The check above can lose a race with a concurrent save; the unique index
// then refuses the write. Report that the same way.
function rethrowEmailClash(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes("email")
  ) {
    throw new EmailTakenError();
  }
  throw error;
}

/**
 * Placeholder written over a deleted user's email so the real address can be
 * registered again. The original stays in the audit log's DELETE entry.
 */
export function releasedEmail(userId: string) {
  return `deleted-${userId}@deleted.invalid`;
}

export type CreateUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  userStatusId?: string | null;
  roleIds?: string[];
  /**
   * Target tenant for the new user. `undefined` falls back to `ctx.tenantId`
   * (the actor's own tenant — existing behaviour). `null` creates a tenantless
   * "regular user." A string sets a specific target tenant. Only callers with
   * cross-tenant authority (global admins) should pass an override.
   *
   * Setting a non-null tenantId here writes the column on the new User row
   * but does NOT grant the tenant's admin role. Callers that want the new
   * user to be an admin of the tenant should follow up with
   * `setUserTenantAssignment` (which is idempotent — re-running with the
   * same tenantId fills in the role wiring).
   */
  tenantId?: string | null;
};

export async function createUser(input: CreateUserInput, ctx: TenantServiceContext) {
  const targetTenantId = input.tenantId === undefined ? ctx.tenantId : input.tenantId;

  await assertEmailAvailable(input.email);

  const created = await prisma
    .$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          tenantId: targetTenantId,
          userStatusId: input.userStatusId ?? null,
        },
      });

      if (input.password) {
        await tx.password.create({
          data: { userId: u.id, hash: await hash(input.password, 10) },
        });
      }

      if (input.roleIds && input.roleIds.length > 0) {
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({ userId: u.id, roleId })),
        });
      }

      return u;
    })
    .catch(rethrowEmailClash);

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "user",
    entityId: created.id,
    description: `Created user ${created.email}${targetTenantId ? ` in tenant ${targetTenantId}` : " (regular)"}`,
  });

  return created;
}

export type UpdateUserInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  userStatusId?: string | null;
};

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  ctx: TenantServiceContext,
) {
  if (input.email !== undefined) await assertEmailAvailable(input.email, userId);

  const updated = await prisma.user
    .update({
      where: { id: userId },
      data: {
        ...(input.firstName !== undefined && { firstName: input.firstName }),
        ...(input.lastName !== undefined && { lastName: input.lastName }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.userStatusId !== undefined && { userStatusId: input.userStatusId }),
      },
    })
    .catch(rethrowEmailClash);

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "user",
    entityId: userId,
    description: `Updated user ${updated.email}`,
  });

  return updated;
}

/**
 * Move a user between tenants (or to/from "regular user" status).
 *
 * Side effects beyond setting `User.tenantId`:
 *   - Drops every tenant-scoped UserRole the user has in OTHER tenants
 *     (focal/manager are tenant-scoped roles whose authority follows the
 *     user's home tenant; moving the user is treated as a fresh slate, so the
 *     admin must re-grant them explicitly in the new tenant context).
 *   - Global-scope grants (`admin`, `user`) are preserved.
 *   - Does NOT auto-grant any role on move. Granting `manager`/`focal` is an
 *     explicit step via the user-roles UI.
 *
 * Idempotent. Re-running on a user already in the target state is a no-op.
 */
export async function setUserTenantAssignment(
  userId: string,
  newTenantId: string | null,
  ctx: TenantServiceContext,
): Promise<void> {
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true, email: true },
  });
  if (!currentUser) throw new Error("User not found");

  const oldTenantId = currentUser.tenantId;

  await prisma.$transaction(async (tx) => {
    // Strip TENANT-scope role grants on move — focal/manager authority
    // belongs to the user's previous tenant context. Admins re-grant in the
    // new tenant via the user-roles UI. GLOBAL-scope grants stay put.
    if (oldTenantId !== newTenantId) {
      await tx.userRole.deleteMany({
        where: { userId, role: { scope: RoleScope.TENANT } },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: { tenantId: newTenantId },
    });
  });

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "user",
    entityId: userId,
    description: `Reassigned ${currentUser.email}: tenant ${oldTenantId ?? "regular"} → ${newTenantId ?? "regular"}`,
  });
}

/** Refused because it would leave the platform with no admin. */
export class LastAdminError extends Error {
  constructor() {
    super("This is the only platform admin. Make someone else an admin first.");
  }
}

const GLOBAL_ADMIN_ROLE = { name: "admin", scope: RoleScope.GLOBAL };

// Call before taking the platform-admin role (or the account) away from
// `userId`. Without an admin nobody can manage tenants or roles again.
async function assertNotLastGlobalAdmin(userId: string) {
  const admins = await prisma.user.findMany({
    where: { deletedAt: null, userRoles: { some: { role: GLOBAL_ADMIN_ROLE } } },
    select: { id: true },
    take: 2,
  });
  if (admins.length === 1 && admins[0].id === userId) throw new LastAdminError();
}

export async function softDeleteUser(userId: string, ctx: TenantServiceContext) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  await assertNotLastGlobalAdmin(userId);
  // Deleting the sessions signs the user out everywhere at once. Swapping the
  // email for a placeholder lets the address be registered again.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), email: releasedEmail(userId) },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "DELETE",
    entityType: "user",
    entityId: userId,
    description: `Deleted user ${existing?.email ?? userId}`,
  });
}

export async function replaceUserRoles(
  userId: string,
  roleIds: string[],
  ctx: TenantServiceContext,
) {
  const keepsAdmin =
    roleIds.length > 0 &&
    (await prisma.role.count({ where: { id: { in: roleIds }, ...GLOBAL_ADMIN_ROLE } })) > 0;
  if (!keepsAdmin) await assertNotLastGlobalAdmin(userId);

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId } });
    if (roleIds.length > 0) {
      await tx.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId })),
      });
    }
  });
  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "user-roles",
    entityId: userId,
    description: `Replaced role assignments (${roleIds.length} role${roleIds.length === 1 ? "" : "s"})`,
  });
}
