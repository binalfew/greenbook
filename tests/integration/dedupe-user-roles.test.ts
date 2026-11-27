import { describe, expect, it } from "vitest";
import { buildTenant, buildUser } from "../factories";
import { prisma } from "../setup/integration-setup";

import { dedupeUserRoles } from "../../prisma/dedupe-user-roles";

// The unique index on (userId, roleId) is new. A database from before it can
// hold the same role twice for a user, and the schema push refuses to add the
// index until those rows are gone.

const UNIQUE_INDEX = `"UserRole_userId_roleId_key"`;
const query = (sql: string) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);

describe("removing duplicate user roles before a schema push", () => {
  it("keeps one row per user and role so the unique index can be created", async () => {
    const tenant = await prisma.tenant.create({ data: buildTenant() });
    const user = await prisma.user.create({ data: buildUser({ tenantId: tenant.id }) });
    const other = await prisma.user.create({ data: buildUser({ tenantId: tenant.id }) });
    const manager = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
    const focal = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });

    await prisma.$executeRawUnsafe(`DROP INDEX ${UNIQUE_INDEX}`);
    try {
      await prisma.userRole.createMany({
        data: [
          { userId: user.id, roleId: manager.id },
          { userId: user.id, roleId: manager.id },
          { userId: user.id, roleId: manager.id },
          { userId: user.id, roleId: focal.id },
          { userId: other.id, roleId: manager.id },
        ],
      });

      expect(await dedupeUserRoles(query)).toBe(2);
      expect(await dedupeUserRoles(query)).toBe(0);

      const left = await prisma.userRole.findMany({ select: { userId: true, roleId: true } });
      expect(left).toHaveLength(3);
      expect(left).toEqual(
        expect.arrayContaining([
          { userId: user.id, roleId: manager.id },
          { userId: user.id, roleId: focal.id },
          { userId: other.id, roleId: manager.id },
        ]),
      );
    } finally {
      // Recreating the index only succeeds if no duplicates are left.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX ${UNIQUE_INDEX} ON "UserRole"("userId", "roleId")`,
      );
    }
  });

  it("does nothing on a database that has no tables yet", async () => {
    const emptyDatabase = async (sql: string) => {
      if (sql.includes("to_regclass")) return [{ table: null }];
      throw new Error(`unexpected query: ${sql}`);
    };

    expect(await dedupeUserRoles(emptyDatabase)).toBe(0);
  });
});
