import { prisma } from "~/utils/db/db.server";

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  url: string;
}

export interface SearchResults {
  results: SearchResult[];
  total: number;
  query: string;
}

/**
 * Cross-entity search scoped to a tenant. Searches users, roles, permissions,
 * and recent audit log entries. Each app built on the template extends this
 * with its own entities by wrapping `globalSearch` or by implementing its
 * own `app/services/search.server.ts` that composes the template helpers.
 *
 * Returns at most `limit` results (default 50, capped at 100). Short queries
 * (<2 chars) return empty to avoid accidentally matching everything.
 */
export async function globalSearch(
  query: string,
  tenantId: string,
  options: { limit?: number } = {},
): Promise<SearchResults> {
  const limit = Math.min(options.limit ?? 50, 100);

  if (!query || query.trim().length < 2) {
    return { results: [], total: 0, query };
  }

  const term = query.trim();
  const contains = { contains: term, mode: "insensitive" as const };

  const [users, roles, permissions, auditLogs] = await Promise.all([
    prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ firstName: contains }, { lastName: contains }, { email: contains }],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      take: limit,
    }),
    prisma.role.findMany({
      where: {
        tenantId,
        OR: [{ name: contains }, { description: contains }],
      },
      select: { id: true, name: true, description: true },
      take: limit,
    }),
    prisma.permission.findMany({
      where: {
        OR: [{ resource: contains }, { action: contains }, { description: contains }],
      },
      select: { id: true, resource: true, action: true, description: true },
      take: limit,
    }),
    prisma.auditLog.findMany({
      where: {
        tenantId,
        OR: [{ description: contains }, { entityType: contains }],
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  // URLs are relative to the tenant basePrefix — the command palette prepends
  // `${basePrefix}/` at navigation time. Keeps this service tenant-agnostic and
  // lets forks swap the basePrefix (e.g., `/admin` vs `/acme`) without touching
  // the search layer.
  const results: SearchResult[] = [
    ...users.map((u) => ({
      id: u.id,
      type: "User",
      title: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
      subtitle: u.email,
      url: `settings/users/${u.id}`,
    })),
    ...roles.map((r) => ({
      id: r.id,
      type: "Role",
      title: r.name,
      subtitle: r.description ?? undefined,
      url: `settings/roles/${r.id}`,
    })),
    ...permissions.map((p) => ({
      id: p.id,
      type: "Permission",
      title: `${p.resource}:${p.action}`,
      subtitle: p.description ?? undefined,
      url: `settings/permissions/${p.id}`,
    })),
    ...auditLogs.map((a) => ({
      id: a.id,
      type: "AuditLog",
      title: `${a.action} ${a.entityType}`,
      subtitle: a.description ?? undefined,
      url: `logs`,
    })),
  ];

  return {
    results: results.slice(0, limit),
    total: results.length,
    query,
  };
}
