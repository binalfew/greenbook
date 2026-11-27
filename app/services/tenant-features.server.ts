import { clearPublicTenantIdsCache } from "~/services/public-directory.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import {
  addTenantToFlag,
  removeTenantFromFlag,
} from "~/utils/config/tenant-flag-membership.server";
import { prisma } from "~/utils/db/db.server";
import type { ServiceContext } from "~/utils/types.server";

// One tenant's membership of the tenant-scoped feature flags, for the global
// admin's per-tenant features screen. For a tenant-scoped flag, being on the
// flag's enabled list is the whole gate.

export type TenantFeature = {
  key: string;
  description: string | null;
  /** Whether this tenant is on the flag's enabled list. */
  enabled: boolean;
};

/** The flag key does not name a tenant-scoped flag. */
export class NotATenantFlagError extends Error {
  constructor(flagKey: string) {
    super(`"${flagKey}" is not a tenant-scoped feature flag`);
  }
}

export async function listTenantFeatures(tenantId: string): Promise<TenantFeature[]> {
  const flags = await prisma.featureFlag.findMany({
    where: { scope: "tenant" },
    orderBy: { key: "asc" },
    select: { key: true, description: true, enabledForTenants: true },
  });
  return flags.map((flag) => ({
    key: flag.key,
    description: flag.description,
    enabled: flag.enabledForTenants.includes(tenantId),
  }));
}

/** Opt the tenant in to (`enabled`) or out of a tenant-scoped flag. */
export async function setTenantFeature(
  tenantId: string,
  flagKey: string,
  enabled: boolean,
  ctx: ServiceContext,
): Promise<void> {
  const flag = await prisma.featureFlag.findUnique({
    where: { key: flagKey },
    select: { id: true, scope: true },
  });
  if (!flag || flag.scope !== "tenant") throw new NotATenantFlagError(flagKey);

  if (enabled) await addTenantToFlag(prisma, flagKey, tenantId);
  else await removeTenantFromFlag(prisma, flagKey, tenantId);

  clearFlagCache();
  clearPublicTenantIdsCache();

  await writeAudit({
    tenantId,
    userId: ctx.userId,
    action: "CONFIGURE",
    entityType: "feature_flag",
    entityId: flag.id,
    description: `${enabled ? "Enabled" : "Disabled"} feature flag "${flagKey}" for the tenant`,
    metadata: { key: flagKey, tenantId, enabled },
  });
}
