import type { FeatureFlag } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "~/utils/config/feature-flag-keys";
import { MemoryCache } from "~/utils/db/memory-cache.server";
import { prisma } from "~/utils/db/db.server";
import type { ServiceContext } from "~/utils/types.server";

// Re-export so existing server callers keep importing keys from this file.
export { FEATURE_FLAG_KEYS };
export type { FeatureFlagKey };

export interface FlagContext {
  tenantId?: string;
  roles?: string[];
  userId?: string;
}

export interface FlagWithStatus {
  id: string;
  key: string;
  description: string | null;
  scope: string;
  enabled: boolean;
  enabledForTenants: string[];
  disabledForTenants: string[];
  enabledForRoles: string[];
  enabledForUsers: string[];
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateFlagInput {
  description?: string | null;
  scope?: "global" | "tenant";
  enabled?: boolean;
  enabledForTenants?: string[];
  disabledForTenants?: string[];
  enabledForRoles?: string[];
  enabledForUsers?: string[];
}

type CachedFlag = Pick<
  FeatureFlag,
  | "scope"
  | "enabled"
  | "enabledForTenants"
  | "disabledForTenants"
  | "enabledForRoles"
  | "enabledForUsers"
>;

// 60s TTL — admin writes call clearFlagCache() on the key so the new value
// is visible immediately to subsequent readers.
const flagCache = new MemoryCache<CachedFlag | null>(60_000);

export function clearFlagCache(): void {
  flagCache.clear();
}

export async function isFeatureEnabled(key: string, context?: FlagContext): Promise<boolean> {
  let flag = flagCache.get(key);
  if (flag === undefined) {
    const dbFlag = await prisma.featureFlag.findUnique({ where: { key } });
    flag = dbFlag
      ? {
          scope: dbFlag.scope,
          enabled: dbFlag.enabled,
          enabledForTenants: dbFlag.enabledForTenants,
          disabledForTenants: dbFlag.disabledForTenants,
          enabledForRoles: dbFlag.enabledForRoles,
          enabledForUsers: dbFlag.enabledForUsers,
        }
      : null;
    flagCache.set(key, flag);
  }
  if (!flag) return false;
  return evaluateFlag(flag, context);
}

function evaluateFlag(flag: CachedFlag, context?: FlagContext): boolean {
  // Global-scoped flags: on for all tenants when enabled, unless tenant opted out.
  if (flag.scope === "global") {
    if (!flag.enabled) return false;
    if (context?.tenantId && flag.disabledForTenants.includes(context.tenantId)) return false;
    return true;
  }

  // No context (system call) — fall back to the global enabled toggle.
  if (!context || !context.tenantId) return flag.enabled;

  // Tenant-scoped flags: off by default, on when tenant/role/user in allow list.
  if (flag.enabledForTenants.includes(context.tenantId)) return true;
  if (context.roles?.some((role) => flag.enabledForRoles.includes(role))) return true;
  if (context.userId && flag.enabledForUsers.includes(context.userId)) return true;
  return false;
}

export async function getAllFlags(context?: FlagContext): Promise<FlagWithStatus[]> {
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  return flags.map((flag) => ({
    ...flag,
    isEnabled: evaluateFlag(flag, context),
  }));
}

export async function setFlag(
  key: string,
  updates: UpdateFlagInput,
  ctx: ServiceContext,
): Promise<FeatureFlag> {
  const flag = await prisma.featureFlag.update({
    where: { key },
    data: {
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.scope !== undefined && { scope: updates.scope }),
      ...(updates.enabled !== undefined && { enabled: updates.enabled }),
      ...(updates.enabledForTenants !== undefined && {
        enabledForTenants: updates.enabledForTenants,
      }),
      ...(updates.disabledForTenants !== undefined && {
        disabledForTenants: updates.disabledForTenants,
      }),
      ...(updates.enabledForRoles !== undefined && { enabledForRoles: updates.enabledForRoles }),
      ...(updates.enabledForUsers !== undefined && { enabledForUsers: updates.enabledForUsers }),
    },
  });

  flagCache.invalidate(key);

  await writeAudit({
    tenantId: ctx.tenantId ?? null,
    userId: ctx.userId,
    action: "CONFIGURE",
    entityType: "feature_flag",
    entityId: flag.id,
    description: `Updated feature flag "${key}" (enabled: ${flag.enabled})`,
    metadata: { key, ...updates },
  });

  return flag;
}
