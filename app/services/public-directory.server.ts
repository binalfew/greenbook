import { FEATURE_FLAG_KEYS } from "~/utils/config/feature-flag-keys";
import { prisma } from "~/utils/db/db.server";
import { MemoryCache } from "~/utils/db/memory-cache.server";

// Public-directory gate.
//
// Every `public*` service helper (cross-tenant, un-authenticated) passes
// through this gate. It returns the set of tenant ids that have opted
// into the unified public directory via `FF_PUBLIC_DIRECTORY`.
//
// Invariant: public helpers MUST filter `tenantId: { in: await getPublicTenantIds() }`.
// An integration test asserts opted-out tenants never appear in public output.

// 5-minute TTL — flags are admin-owned and change rarely.
// `clearFlagCache` in feature-flags.server.ts does not reach into this
// cache, so admin edits take up to 5 minutes to propagate. Acceptable for
// a tier whose latency budget is already measured in seconds.
const cache = new MemoryCache<string[]>(5 * 60_000);
const CACHE_KEY = "public_tenant_ids";

export function clearPublicTenantIdsCache(): void {
  cache.clear();
}

export async function getPublicTenantIds(): Promise<string[]> {
  const cached = cache.get(CACHE_KEY);
  if (cached !== undefined) return cached;

  const flag = await prisma.featureFlag.findUnique({
    where: { key: FEATURE_FLAG_KEYS.PUBLIC_DIRECTORY },
    select: { enabled: true, scope: true, enabledForTenants: true, disabledForTenants: true },
  });

  if (!flag) {
    cache.set(CACHE_KEY, []);
    return [];
  }

  // If the flag is global-scope + enabled, every tenant participates
  // (minus the disabled list). If it's tenant-scoped, only the explicitly
  // enabled tenants participate.
  if (flag.scope === "global") {
    if (!flag.enabled) {
      cache.set(CACHE_KEY, []);
      return [];
    }
    const tenants = await prisma.tenant.findMany({
      where: {
        deletedAt: null,
        ...(flag.disabledForTenants.length > 0 ? { id: { notIn: flag.disabledForTenants } } : {}),
      },
      select: { id: true },
    });
    const ids = tenants.map((t) => t.id);
    cache.set(CACHE_KEY, ids);
    return ids;
  }

  // tenant scope
  const ids = [...flag.enabledForTenants];
  cache.set(CACHE_KEY, ids);
  return ids;
}
