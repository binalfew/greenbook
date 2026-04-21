import type { SystemSetting } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { SETTING_DEFAULTS } from "~/utils/config/settings-registry";
import { prisma } from "~/utils/db/db.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import type { ServiceContext } from "~/utils/types.server";

export interface SettingContext {
  userId?: string;
  tenantId?: string;
}

export interface ResolvedSetting {
  key: string;
  value: string;
  type: string;
  category: string;
  scope: string;
  scopeId: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

export type UpsertSettingInput = {
  key: string;
  value: string;
  type?: string;
  category?: string;
  scope: "global" | "tenant" | "user";
  scopeId: string;
};

// user > tenant > global — numeric priority so we can sort
const SCOPE_PRIORITY: Record<string, number> = {
  user: 3,
  tenant: 2,
  global: 1,
};

// ─── Read ────────────────────────────────────────────────

export async function getSetting(
  key: string,
  context?: SettingContext,
): Promise<ResolvedSetting | null> {
  const scopeFilters: Array<{ scope: string; scopeId: string }> = [
    { scope: "global", scopeId: "" },
  ];
  if (context?.tenantId) scopeFilters.push({ scope: "tenant", scopeId: context.tenantId });
  if (context?.userId) scopeFilters.push({ scope: "user", scopeId: context.userId });

  const rows = await prisma.systemSetting.findMany({
    where: { key, OR: scopeFilters },
  });

  if (rows.length === 0) {
    const def = SETTING_DEFAULTS[key];
    if (!def) return null;
    return {
      key,
      value: def.value,
      type: def.type,
      category: def.category,
      scope: "default",
      scopeId: "",
      lastAccessedAt: null,
      accessCount: 0,
    };
  }

  rows.sort((a, b) => (SCOPE_PRIORITY[b.scope] ?? 0) - (SCOPE_PRIORITY[a.scope] ?? 0));
  const best = rows[0];

  // Fire-and-forget access tracking — never block the resolver on this.
  prisma.systemSetting
    .update({
      where: { id: best.id },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    })
    .catch(() => undefined);

  return toResolved(best);
}

export async function getSettingsByCategory(
  category: string,
  context?: SettingContext,
): Promise<ResolvedSetting[]> {
  const dbKeys = await prisma.systemSetting.findMany({
    where: { category },
    select: { key: true },
    distinct: ["key"],
  });
  const keys = new Set<string>(dbKeys.map((r) => r.key));
  for (const [k, def] of Object.entries(SETTING_DEFAULTS)) {
    if (def.category === category) keys.add(k);
  }

  const resolved: ResolvedSetting[] = [];
  for (const key of keys) {
    const r = await getSetting(key, context);
    if (r) resolved.push(r);
  }
  return resolved.sort((a, b) => a.key.localeCompare(b.key));
}

export async function getAllSettings(
  context?: SettingContext,
): Promise<Record<string, ResolvedSetting[]>> {
  const categoriesFromDb = await prisma.systemSetting.findMany({
    select: { category: true },
    distinct: ["category"],
  });
  const categories = new Set<string>(categoriesFromDb.map((r) => r.category));
  for (const def of Object.values(SETTING_DEFAULTS)) categories.add(def.category);

  const grouped: Record<string, ResolvedSetting[]> = {};
  for (const category of categories) {
    grouped[category] = await getSettingsByCategory(category, context);
  }
  return grouped;
}

// ─── Write ───────────────────────────────────────────────

export async function setSetting(
  input: UpsertSettingInput,
  ctx: ServiceContext,
): Promise<SystemSetting> {
  const setting = await prisma.systemSetting.upsert({
    where: {
      key_scope_scopeId: {
        key: input.key,
        scope: input.scope,
        scopeId: input.scopeId,
      },
    },
    update: {
      value: input.value,
      type: input.type ?? "string",
      category: input.category ?? "general",
    },
    create: {
      key: input.key,
      value: input.value,
      type: input.type ?? "string",
      category: input.category ?? "general",
      scope: input.scope,
      scopeId: input.scopeId,
      tenantId: input.scope === "tenant" ? input.scopeId : null,
    },
  });

  await writeAudit({
    tenantId: ctx.tenantId ?? null,
    userId: ctx.userId,
    action: "CONFIGURE",
    entityType: "system_setting",
    entityId: setting.id,
    description: `Set "${input.key}" = "${input.value}" at scope ${input.scope}`,
    metadata: {
      key: input.key,
      value: input.value,
      scope: input.scope,
      scopeId: input.scopeId,
    },
  });

  // Only emit when scoped to a tenant — global/user scopes don't carry a
  // tenant for webhook routing.
  if (input.scope === "tenant" && input.scopeId) {
    emitDomainEvent(input.scopeId, "settings.changed", {
      key: input.key,
      value: input.value,
      scope: input.scope,
    });
  }

  return setting;
}

export async function deleteSetting(
  key: string,
  scope: string,
  scopeId: string,
  ctx: ServiceContext,
): Promise<{ success: boolean }> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key_scope_scopeId: { key, scope, scopeId } },
  });
  if (!setting) return { success: false };

  await prisma.systemSetting.delete({
    where: { key_scope_scopeId: { key, scope, scopeId } },
  });

  await writeAudit({
    tenantId: ctx.tenantId ?? null,
    userId: ctx.userId,
    action: "CONFIGURE",
    entityType: "system_setting",
    entityId: setting.id,
    description: `Deleted setting "${key}" at scope ${scope}`,
    metadata: { key, scope, scopeId },
  });

  return { success: true };
}

// ─── Helpers ─────────────────────────────────────────────

function toResolved(row: SystemSetting): ResolvedSetting {
  return {
    key: row.key,
    value: row.value,
    type: row.type,
    category: row.category,
    scope: row.scope,
    scopeId: row.scopeId,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    accessCount: row.accessCount,
  };
}
