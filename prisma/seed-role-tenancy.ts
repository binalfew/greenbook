import type { PrismaClient } from "../app/generated/prisma/client";

/**
 * Roles are platform-wide definitions and belong to no tenant. Roles created
 * before that rule were stored against the creating admin's home tenant; this
 * moves them to `tenantId = null`, keeping their holders and permissions.
 *
 * Role names are unique platform-wide, so a role whose name is already taken
 * is renamed after the tenant it came from ("editor (misd)").
 *
 * Idempotent: a second run finds nothing to move.
 */
export async function detachRolesFromTenants(prisma: PrismaClient): Promise<number> {
  const tied = await prisma.role.findMany({
    where: { tenantId: { not: null } },
    select: { id: true, name: true, tenant: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (tied.length === 0) return 0;

  // A name is free only if no other role uses it — neither a platform-wide
  // one nor another tenant's role that is about to be moved.
  const taken = new Map<string, number>();
  for (const role of await prisma.role.findMany({ select: { name: true } })) {
    const key = role.name.toLowerCase();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }

  for (const role of tied) {
    let name = role.name;
    if ((taken.get(name.toLowerCase()) ?? 0) > 1) {
      const suffix = ` (${role.tenant?.slug ?? role.id})`;
      name = `${role.name.slice(0, 100 - suffix.length)}${suffix}`;
    }
    await prisma.role.update({ where: { id: role.id }, data: { tenantId: null, name } });
  }
  return tied.length;
}
