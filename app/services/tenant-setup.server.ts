import type { Prisma } from "~/generated/prisma/client";
import { INITIAL_USER_ROLES, type InitialUserRole } from "~/utils/schemas/tenant";

export type InitialUser = { userId: string; role: InitialUserRole };

/**
 * The user picked as a new tenant's initial user cannot be placed in it, for
 * a reason the admin can fix. The message is safe to show next to the field.
 */
export class InitialUserError extends Error {
  constructor() {
    super("This user is no longer available. Choose a user who belongs to no tenant.");
  }
}

/**
 * Make an existing tenantless user a member of a tenant as its focal person
 * or manager. Their other roles are kept, so they stay a directory reader.
 *
 * Runs on the caller's transaction, so a tenant is never left behind when its
 * initial user turns out to be unusable.
 */
export async function placeInitialUser(
  tx: Prisma.TransactionClient,
  tenantId: string,
  { userId, role }: InitialUser,
): Promise<void> {
  // The condition is part of the write, so a user who joined a tenant or was
  // deleted since the form was loaded is refused rather than moved.
  const moved = await tx.user.updateMany({
    where: { id: userId, tenantId: null, deletedAt: null },
    data: { tenantId },
  });
  if (moved.count !== 1) throw new InitialUserError();

  const roles = await tx.role.findMany({
    where: { tenantId: null, name: { in: [...INITIAL_USER_ROLES] } },
    select: { id: true, name: true },
  });
  const chosen = roles.find((r) => r.name === role);
  if (!chosen) {
    throw new Error(`Role "${role}" is missing. Run \`npm run db:seed\` to provision it.`);
  }

  // Exactly one of focal / manager: the one the admin chose.
  await tx.userRole.deleteMany({ where: { userId, roleId: { in: roles.map((r) => r.id) } } });
  await tx.userRole.create({ data: { userId, roleId: chosen.id } });
}
