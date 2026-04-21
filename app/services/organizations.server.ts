import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import { normaliseSearchTerm } from "~/utils/db/search.server";
import { logger } from "~/utils/monitoring/logger.server";
import type { MovePayload, OrganizationPayload } from "~/utils/schemas/directory";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

// Directory: Organizations
//
// Reads are public-API. Writes are intentionally named `_apply*` and called
// ONLY from `directory-changes.server.ts` (the change-request engine). Route
// actions never invoke the writes directly — every mutation flows through
// the approval queue.

export class OrganizationError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "OrganizationError";
    this.status = status;
    this.code = code;
  }
}

const orgSelect = {
  id: true,
  tenantId: true,
  name: true,
  acronym: true,
  typeId: true,
  parentId: true,
  description: true,
  mandate: true,
  establishmentDate: true,
  isActive: true,
  website: true,
  email: true,
  phone: true,
  address: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

const orgListInclude = {
  type: { select: { id: true, name: true, code: true, level: true } },
  parent: { select: { id: true, name: true, acronym: true } },
  _count: {
    select: {
      children: { where: { deletedAt: null } },
      positions: { where: { deletedAt: null } },
    },
  },
} as const;

// Roots have parentId: null by definition — skip the parent join to avoid
// a no-op lookup per row. Used by the tree view's root-level query.
const orgRootInclude = {
  type: { select: { id: true, name: true, code: true, level: true } },
  _count: {
    select: {
      children: { where: { deletedAt: null } },
      positions: { where: { deletedAt: null } },
    },
  },
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────

export async function listOrganizations(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const search = normaliseSearchTerm(where.search);
  const searchFilter = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { acronym: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const typeFilter = where.typeId ? { typeId: where.typeId as string } : {};

  const filter: Prisma.OrganizationWhereInput = {
    tenantId,
    deletedAt: null,
    ...searchFilter,
    ...typeFilter,
  };

  const [data, total] = await Promise.all([
    prisma.organization.findMany({
      where: filter,
      orderBy: orderBy ?? [{ sortOrder: "asc" }, { name: "asc" }],
      skip,
      take: pageSize,
      include: orgListInclude,
    }),
    prisma.organization.count({ where: filter }),
  ]);

  return { data, total };
}

export async function listRootOrganizations(tenantId: string) {
  return prisma.organization.findMany({
    where: { tenantId, deletedAt: null, parentId: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: orgRootInclude,
  });
}

export async function listOrganizationChildren(parentId: string, tenantId: string) {
  return prisma.organization.findMany({
    where: { tenantId, deletedAt: null, parentId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: orgListInclude,
  });
}

// Children + positions are capped so detail pages stay snappy even for a
// department with hundreds of posts. Callers that need the full list use
// the dedicated listPositionsForOrganization / listOrganizationChildren
// endpoints (paginated).
const ORG_DETAIL_CHILDREN_TAKE = 50;
const ORG_DETAIL_POSITIONS_TAKE = 20;

export async function getOrganization(id: string, tenantId: string) {
  const org = await prisma.organization.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      type: { select: { id: true, name: true, code: true, level: true } },
      parent: { select: { id: true, name: true, acronym: true } },
      children: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: ORG_DETAIL_CHILDREN_TAKE,
        select: { id: true, name: true, acronym: true },
      },
      positions: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        take: ORG_DETAIL_POSITIONS_TAKE,
        include: { type: { select: { id: true, name: true } } },
      },
      _count: {
        select: {
          children: { where: { deletedAt: null } },
          positions: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!org) throw new OrganizationError("Organization not found", 404, "NOT_FOUND");
  return org;
}

// Narrow lookup for destructive-confirm dialogs: just name + child count.
// Avoids pulling positions, children rows, and type/parent joins for a
// two-sentence confirmation body.
export async function getOrganizationForDelete(id: string, tenantId: string) {
  const org = await prisma.organization.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      _count: { select: { children: { where: { deletedAt: null } } } },
    },
  });
  if (!org) throw new OrganizationError("Organization not found", 404, "NOT_FOUND");
  return org;
}

export async function getOrganizationAncestry(
  id: string,
  tenantId: string,
): Promise<{ id: string; name: string; acronym: string | null }[]> {
  const chain: { id: string; name: string; acronym: string | null }[] = [];
  let cursor: string | null = id;
  for (let depth = 0; depth < 32 && cursor; depth++) {
    const row: {
      id: string;
      name: string;
      acronym: string | null;
      parentId: string | null;
    } | null = await prisma.organization.findFirst({
      where: { id: cursor, tenantId, deletedAt: null },
      select: { id: true, name: true, acronym: true, parentId: true },
    });
    if (!row) break;
    chain.unshift({ id: row.id, name: row.name, acronym: row.acronym });
    cursor = row.parentId;
  }
  return chain;
}

// ─── Guards ─────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma;

export async function assertNoCycle(
  orgId: string,
  candidateParentId: string,
  tenantId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (candidateParentId === orgId) {
    throw new OrganizationError("An organization cannot be its own parent", 400, "CIRCULAR_PARENT");
  }
  const db: Db = tx ?? prisma;
  let cursor: string | null = candidateParentId;
  for (let depth = 0; depth < 32 && cursor; depth++) {
    if (cursor === orgId) {
      throw new OrganizationError(
        "Setting this parent would create a cycle",
        400,
        "CIRCULAR_PARENT",
      );
    }
    const row: { parentId: string | null } | null = await db.organization.findFirst({
      where: { id: cursor, tenantId, deletedAt: null },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
  }
}

async function assertReferencedOrganizationType(typeId: string, tenantId: string, db: Db) {
  const row = await db.organizationType.findFirst({
    where: { id: typeId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new OrganizationError(
      "Referenced organization type is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

async function assertReferencedParent(parentId: string, tenantId: string, db: Db) {
  const row = await db.organization.findFirst({
    where: { id: parentId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new OrganizationError(
      "Referenced parent organization is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

// Pure payload-to-data mapper — shared by CREATE (insert) and UPDATE (merge).
// Dates are normalised here so both paths agree on null vs Date semantics.
function orgDataFromPayload(payload: OrganizationPayload) {
  return {
    name: payload.name,
    acronym: payload.acronym ?? null,
    typeId: payload.typeId,
    parentId: payload.parentId ?? null,
    description: payload.description ?? null,
    mandate: payload.mandate ?? null,
    establishmentDate: payload.establishmentDate ? new Date(payload.establishmentDate) : null,
    isActive: payload.isActive ?? true,
    website: payload.website ?? null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    address: payload.address ?? null,
    sortOrder: payload.sortOrder ?? 0,
  };
}

// ─── Internal writers (called only from directory-changes engine) ───────
//
// Every writer takes an optional `tx` so the approval path can run the
// guard + write inside a single transaction. When `tx` is omitted the
// writer falls back to the global prisma client (used by tests + future
// non-approval callers).

export async function _applyCreateOrg(
  tenantId: string,
  payload: OrganizationPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  await assertReferencedOrganizationType(payload.typeId, tenantId, db);
  if (payload.parentId) await assertReferencedParent(payload.parentId, tenantId, db);

  logger.info({ tenantId, userId: ctx.userId, name: payload.name }, "applying CREATE organization");

  return db.organization.create({
    data: { tenantId, ...orgDataFromPayload(payload) },
    select: orgSelect,
  });
}

export async function _applyUpdateOrg(
  id: string,
  tenantId: string,
  payload: OrganizationPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.organization.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true, version: true },
  });
  if (!existing) throw new OrganizationError("Organization not found", 404, "NOT_FOUND");

  await assertReferencedOrganizationType(payload.typeId, tenantId, db);
  if (payload.parentId) {
    await assertReferencedParent(payload.parentId, tenantId, db);
    await assertNoCycle(id, payload.parentId, tenantId, tx);
  }

  logger.info({ tenantId, userId: ctx.userId, orgId: id }, "applying UPDATE organization");

  return db.organization.update({
    where: { id },
    data: { ...orgDataFromPayload(payload), version: { increment: 1 } },
    select: orgSelect,
  });
}

export async function _applyMoveOrg(
  id: string,
  tenantId: string,
  payload: MovePayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.organization.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new OrganizationError("Organization not found", 404, "NOT_FOUND");

  if (payload.parentId) {
    await assertReferencedParent(payload.parentId, tenantId, db);
    await assertNoCycle(id, payload.parentId, tenantId, tx);
  }

  logger.info(
    { tenantId, userId: ctx.userId, orgId: id, newParentId: payload.parentId },
    "applying MOVE organization",
  );

  return db.organization.update({
    where: { id },
    data: { parentId: payload.parentId ?? null, version: { increment: 1 } },
    select: orgSelect,
  });
}

export async function _applySoftDeleteOrg(
  id: string,
  tenantId: string,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.organization.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true, _count: { select: { children: { where: { deletedAt: null } } } } },
  });
  if (!existing) throw new OrganizationError("Organization not found", 404, "NOT_FOUND");
  if (existing._count.children > 0) {
    throw new OrganizationError(
      "Cannot delete an organization that has child organizations",
      400,
      "HAS_CHILDREN",
    );
  }

  logger.info({ tenantId, userId: ctx.userId, orgId: id }, "applying DELETE organization");

  return db.organization.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: orgSelect,
  });
}

// ─── Public read helpers (cross-tenant, opt-in gated) ───────────────────
//
// These take NO tenantId. Callers pass the opted-in tenant set from
// `getPublicTenantIds()`. Service-boundary projection strips `tenantId`.

type PublicOrgNode = {
  id: string;
  name: string;
  acronym: string | null;
  parentId: string | null;
  typeCode: string;
  typeLevel: number;
  childCount: number;
};

function toPublicOrgNode(row: {
  id: string;
  name: string;
  acronym: string | null;
  parentId: string | null;
  type: { code: string; level: number };
  _count: { children: number };
}): PublicOrgNode {
  return {
    id: row.id,
    name: row.name,
    acronym: row.acronym,
    parentId: row.parentId,
    typeCode: row.type.code,
    typeLevel: row.type.level,
    childCount: row._count.children,
  };
}

export async function publicListOrganizationTreeRoots(publicTenantIds: string[]) {
  if (publicTenantIds.length === 0) return [];
  const rows = await prisma.organization.findMany({
    where: { tenantId: { in: publicTenantIds }, deletedAt: null, parentId: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      acronym: true,
      parentId: true,
      type: { select: { code: true, level: true } },
      _count: { select: { children: { where: { deletedAt: null } } } },
    },
  });
  return rows.map(toPublicOrgNode);
}

export async function publicListOrganizationChildren(parentId: string, publicTenantIds: string[]) {
  if (publicTenantIds.length === 0) return [];
  const rows = await prisma.organization.findMany({
    where: { tenantId: { in: publicTenantIds }, deletedAt: null, parentId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      acronym: true,
      parentId: true,
      type: { select: { code: true, level: true } },
      _count: { select: { children: { where: { deletedAt: null } } } },
    },
  });
  return rows.map(toPublicOrgNode);
}

export async function publicGetOrganization(id: string, publicTenantIds: string[]) {
  if (publicTenantIds.length === 0) return null;
  const row = await prisma.organization.findFirst({
    where: { id, tenantId: { in: publicTenantIds }, deletedAt: null },
    select: {
      id: true,
      name: true,
      acronym: true,
      parentId: true,
      description: true,
      mandate: true,
      establishmentDate: true,
      website: true,
      email: true,
      phone: true,
      address: true,
      type: { select: { code: true, name: true, level: true } },
      parent: { select: { id: true, name: true, acronym: true } },
      positions: {
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        take: 50,
        select: { id: true, title: true, type: { select: { name: true } } },
      },
    },
  });
  return row;
}
