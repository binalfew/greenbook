import { prisma } from "~/utils/db/db.server";

export type BootstrapResult = {
  /** Canonical platform `admin` role id (GLOBAL scope). */
  adminRoleId: string;
  /** Canonical `manager` role id (TENANT scope). Was the per-tenant "admin"
   *  before the role consolidation. Tenant onboarding flows that used to
   *  attach the initial admin to a tenant-scoped admin role now attach them
   *  to `manager` instead. */
  managerRoleId: string;
  /** Canonical `focal` role id (TENANT scope). */
  focalRoleId: string;
  /** Canonical `user` role id (GLOBAL scope). */
  userRoleId: string;
};

/**
 * Resolve the four canonical platform-wide role ids: `admin`, `manager`,
 * `focal`, `user`. All four exist as a single row each (tenantId = null) and
 * are seeded by `prisma/seed.ts`.
 *
 * Throws if the seed has not been applied — callers can rely on the four
 * roles being present in any environment that has been initialised.
 */
async function getCanonicalRoleIds(): Promise<BootstrapResult> {
  const roles = await prisma.role.findMany({
    where: { tenantId: null, name: { in: ["admin", "manager", "focal", "user"] } },
    select: { id: true, name: true },
  });
  const byName = new Map(roles.map((r) => [r.name, r.id] as const));
  const missing = ["admin", "manager", "focal", "user"].filter((n) => !byName.has(n));
  if (missing.length > 0) {
    throw new Error(
      `Canonical roles missing from database: ${missing.join(", ")}. ` +
        `Run \`npm run db:seed\` to provision them.`,
    );
  }
  return {
    adminRoleId: byName.get("admin")!,
    managerRoleId: byName.get("manager")!,
    focalRoleId: byName.get("focal")!,
    userRoleId: byName.get("user")!,
  };
}

/**
 * Tenant initialisation hook. With the role consolidation, this no longer
 * creates per-tenant role rows — there are exactly four global Role rows for
 * the whole platform. Tenant creation now does no role plumbing at all.
 *
 * The function is preserved as a thin shim for two reasons:
 *   1. Existing callers (`signup`, `createTenant`, `setUserTenantAssignment`)
 *      continue to attach an "initial manager" to the tenant via this entry
 *      point.
 *   2. Future tenant-scoped initialisation (default settings, sample data,
 *      welcome notifications) can hang off this hook.
 *
 * `initialAdminUserId` (when provided) attaches the user to the canonical
 * `manager` role — that's the consolidated successor of the old per-tenant
 * `admin`. To make someone a platform admin, grant the global `admin` role
 * via the user-roles UI.
 */
export async function bootstrapNewTenant(args: {
  tenantId: string;
  initialAdminUserId?: string;
}): Promise<BootstrapResult> {
  const { initialAdminUserId } = args;
  const canonical = await getCanonicalRoleIds();

  if (initialAdminUserId) {
    // Idempotent: skip if the manager role is already assigned.
    const existing = await prisma.userRole.findFirst({
      where: {
        userId: initialAdminUserId,
        roleId: canonical.managerRoleId,
        eventId: null,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.userRole.create({
        data: { userId: initialAdminUserId, roleId: canonical.managerRoleId },
      });
    }
  }

  return canonical;
}
