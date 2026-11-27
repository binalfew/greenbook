import type { PrismaClient } from "../../generated/prisma/client";

// Membership of a tenant in a tenant-scoped flag's enabled list
// (`FeatureFlag.enabledForTenants`), which is the actual gate for those flags.
//
// Each call is one UPDATE that touches only the given tenant's entry, so the
// other tenants on the list are never rewritten and concurrent calls cannot
// lose each other's change.
//
// The database client is passed in (a transaction client works too) and the
// imports are relative, so the seed script can use this module as well.
// Callers inside the running app should follow a change with `clearFlagCache()`
// and, for FF_PUBLIC_DIRECTORY, `clearPublicTenantIdsCache()`.

type FlagDb = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

async function assertFlagExists(db: FlagDb, flagKey: string) {
  const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM "FeatureFlag" WHERE "key" = ${flagKey}`;
  if (rows.length === 0) throw new Error(`Feature flag "${flagKey}" does not exist`);
}

/** Put the tenant on the flag's enabled list. No effect if it is already there. */
export async function addTenantToFlag(db: FlagDb, flagKey: string, tenantId: string) {
  const changed = await db.$executeRaw`
    UPDATE "FeatureFlag"
    SET "enabledForTenants" = array_append("enabledForTenants", ${tenantId}), "updatedAt" = now()
    WHERE "key" = ${flagKey} AND NOT (${tenantId} = ANY("enabledForTenants"))`;
  if (changed === 0) await assertFlagExists(db, flagKey);
}

/** Take the tenant off the flag's enabled list. No effect if it is not there. */
export async function removeTenantFromFlag(db: FlagDb, flagKey: string, tenantId: string) {
  const changed = await db.$executeRaw`
    UPDATE "FeatureFlag"
    SET "enabledForTenants" = array_remove("enabledForTenants", ${tenantId}), "updatedAt" = now()
    WHERE "key" = ${flagKey} AND ${tenantId} = ANY("enabledForTenants")`;
  if (changed === 0) await assertFlagExists(db, flagKey);
}

/**
 * The tenant-scoped flags every working tenant is opted into when it is
 * provisioned: the directory itself and cross-tenant search. A flag added
 * here reaches tenants created in the UI and by the seed alike.
 */
export const NEW_TENANT_FLAGS = ["FF_DIRECTORY", "FF_PUBLIC_DIRECTORY"] as const;

/** Opt a newly provisioned tenant into every flag in `NEW_TENANT_FLAGS`. */
export async function addTenantToNewTenantFlags(db: FlagDb, tenantId: string) {
  for (const flagKey of NEW_TENANT_FLAGS) {
    await addTenantToFlag(db, flagKey, tenantId);
  }
}
