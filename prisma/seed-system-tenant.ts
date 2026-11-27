import type { PrismaClient } from "../app/generated/prisma/client";
import {
  NEW_TENANT_FLAGS,
  addTenantToFlag,
  removeTenantFromFlag,
} from "../app/utils/config/tenant-flag-membership.server";

/**
 * The system tenant is the global admin's home, not a working tenant. Older
 * databases kept the directory in it; this hands all of that to a working
 * tenant instead of deleting it:
 *
 *  - organizations, people and their photos, positions, assignments and
 *    change requests move as they are (same ids, same timestamps), so every
 *    link between them and every change request's history stays valid;
 *  - users of the system tenant who hold a tenant-scope role (focal persons,
 *    managers) move with the records they work on;
 *  - the system tenant's place on each new-tenant flag's enabled list goes to
 *    the working tenant. A flag the system tenant is not on is left as it is, so
 *    this never turns a flag back on for the working tenant.
 *
 * Idempotent: a second run finds nothing to move. Returns how many directory
 * records and users were moved.
 */
export async function emptySystemTenantDirectory(
  prisma: PrismaClient,
  systemTenantId: string,
  workingTenantId: string,
): Promise<number> {
  if (systemTenantId === workingTenantId) {
    throw new Error("The working tenant must not be the system tenant");
  }

  return prisma.$transaction(async (tx) => {
    // Raw updates so `updatedAt` keeps saying when the record last changed.
    const moved = [
      await tx.$executeRaw`UPDATE "Organization" SET "tenantId" = ${workingTenantId} WHERE "tenantId" = ${systemTenantId}`,
      await tx.$executeRaw`UPDATE "Person" SET "tenantId" = ${workingTenantId} WHERE "tenantId" = ${systemTenantId}`,
      await tx.$executeRaw`UPDATE "PersonPhoto" SET "tenantId" = ${workingTenantId} WHERE "tenantId" = ${systemTenantId}`,
      await tx.$executeRaw`UPDATE "Position" SET "tenantId" = ${workingTenantId} WHERE "tenantId" = ${systemTenantId}`,
      await tx.$executeRaw`UPDATE "PositionAssignment" SET "tenantId" = ${workingTenantId} WHERE "tenantId" = ${systemTenantId}`,
      await tx.$executeRaw`UPDATE "ChangeRequest" SET "tenantId" = ${workingTenantId} WHERE "tenantId" = ${systemTenantId}`,
      await tx.$executeRaw`
        UPDATE "User" SET "tenantId" = ${workingTenantId}
        WHERE "tenantId" = ${systemTenantId}
          AND "id" IN (
            SELECT ur."userId" FROM "UserRole" ur
            JOIN "Role" r ON r."id" = ur."roleId"
            WHERE r."scope" = 'TENANT'
          )`,
    ];

    for (const flagKey of NEW_TENANT_FLAGS) {
      if (await removeTenantFromFlag(tx, flagKey, systemTenantId)) {
        await addTenantToFlag(tx, flagKey, workingTenantId);
      }
    }
    return moved.reduce((sum, n) => sum + n, 0);
  });
}
