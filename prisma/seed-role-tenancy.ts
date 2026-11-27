import type { PrismaClient } from "../app/generated/prisma/client";

/** Length of `Role.name`. */
const NAME_MAX = 100;

/**
 * Roles are platform-wide definitions and belong to no tenant. Roles created
 * before that rule were stored against the creating admin's home tenant; this
 * moves them to `tenantId = null`, keeping their holders and permissions.
 *
 * Role names are unique platform-wide, whatever the case. A role keeps its
 * name when no platform-wide role and no older moved role has it; otherwise
 * it is renamed after the tenant it came from ("editor (misd)"), with a
 * number when that is taken too ("editor (misd 2)").
 *
 * Idempotent: a second run finds nothing to move.
 */
export async function detachRolesFromTenants(prisma: PrismaClient): Promise<number> {
  const tied = await prisma.role.findMany({
    where: { tenantId: { not: null } },
    select: { id: true, name: true, tenant: { select: { slug: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (tied.length === 0) return 0;

  const platformWide = await prisma.role.findMany({
    where: { tenantId: null },
    select: { name: true },
  });
  const taken = new Set(platformWide.map((r) => r.name.toLowerCase()));
  const isFree = (name: string) => !taken.has(name.toLowerCase());

  for (const role of tied) {
    const origin = role.tenant?.slug ?? role.id;
    let name = role.name;
    for (let n = 1; !isFree(name); n++) {
      const suffix = n === 1 ? ` (${origin})` : ` (${origin} ${n})`;
      name = `${role.name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    }
    taken.add(name.toLowerCase());
    await prisma.role.update({ where: { id: role.id }, data: { tenantId: null, name } });
  }
  return tied.length;
}
