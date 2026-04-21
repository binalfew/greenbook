import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import { normaliseSearchTerm } from "~/utils/db/search.server";
import { logger } from "~/utils/monitoring/logger.server";
import type { PositionPayload } from "~/utils/schemas/directory";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

export class PositionError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "PositionError";
    this.status = status;
    this.code = code;
  }
}

const positionSelect = {
  id: true,
  tenantId: true,
  organizationId: true,
  typeId: true,
  title: true,
  reportsToId: true,
  description: true,
  isActive: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

const positionListInclude = {
  organization: { select: { id: true, name: true, acronym: true } },
  type: { select: { id: true, name: true, code: true } },
  reportsTo: { select: { id: true, title: true } },
  _count: {
    select: {
      assignments: { where: { deletedAt: null, isCurrent: true } },
    },
  },
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────

export async function listPositions(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const search = normaliseSearchTerm(where.search);
  const searchFilter = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const filter: Prisma.PositionWhereInput = {
    tenantId,
    deletedAt: null,
    ...searchFilter,
    ...(where.organizationId ? { organizationId: where.organizationId as string } : {}),
    ...(where.typeId ? { typeId: where.typeId as string } : {}),
    ...(typeof where.isActive === "boolean" ? { isActive: where.isActive } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.position.findMany({
      where: filter,
      orderBy: orderBy ?? [{ sortOrder: "asc" }, { title: "asc" }],
      skip,
      take: pageSize,
      include: positionListInclude,
    }),
    prisma.position.count({ where: filter }),
  ]);

  return { data, total };
}

export async function listPositionsForOrganization(organizationId: string, tenantId: string) {
  return prisma.position.findMany({
    where: { organizationId, tenantId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: positionListInclude,
  });
}

export async function getPosition(id: string, tenantId: string) {
  const position = await prisma.position.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      organization: { select: { id: true, name: true, acronym: true } },
      type: { select: { id: true, name: true, code: true } },
      reportsTo: { select: { id: true, title: true } },
      reports: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: { id: true, title: true },
      },
      assignments: {
        where: { deletedAt: null },
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
        include: {
          person: {
            select: { id: true, firstName: true, lastName: true, honorific: true },
          },
        },
      },
    },
  });
  if (!position) throw new PositionError("Position not found", 404, "NOT_FOUND");
  return position;
}

// ─── Guards ─────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma;

async function assertReferencedOrganization(organizationId: string, tenantId: string, db: Db) {
  const row = await db.organization.findFirst({
    where: { id: organizationId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new PositionError(
      "Referenced organization is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

async function assertReferencedType(typeId: string, tenantId: string, db: Db) {
  const row = await db.positionType.findFirst({
    where: { id: typeId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new PositionError(
      "Referenced position type is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

async function assertReferencedReportsTo(
  reportsToId: string,
  tenantId: string,
  db: Db,
  selfId?: string,
) {
  if (selfId && reportsToId === selfId) {
    throw new PositionError("A position cannot report to itself", 400, "CIRCULAR_REPORTING");
  }
  const row = await db.position.findFirst({
    where: { id: reportsToId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new PositionError(
      "Referenced 'reports to' position is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

function positionDataFromPayload(payload: PositionPayload) {
  return {
    organizationId: payload.organizationId,
    typeId: payload.typeId,
    title: payload.title,
    reportsToId: payload.reportsToId ?? null,
    description: payload.description ?? null,
    isActive: payload.isActive ?? true,
    sortOrder: payload.sortOrder ?? 0,
  };
}

// ─── Internal writers ───────────────────────────────────────────────────

export async function _applyCreatePosition(
  tenantId: string,
  payload: PositionPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  await assertReferencedOrganization(payload.organizationId, tenantId, db);
  await assertReferencedType(payload.typeId, tenantId, db);
  if (payload.reportsToId) await assertReferencedReportsTo(payload.reportsToId, tenantId, db);

  logger.info(
    { tenantId, userId: ctx.userId, orgId: payload.organizationId, title: payload.title },
    "applying CREATE position",
  );

  return db.position.create({
    data: { tenantId, ...positionDataFromPayload(payload) },
    select: positionSelect,
  });
}

export async function _applyUpdatePosition(
  id: string,
  tenantId: string,
  payload: PositionPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.position.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new PositionError("Position not found", 404, "NOT_FOUND");

  await assertReferencedOrganization(payload.organizationId, tenantId, db);
  await assertReferencedType(payload.typeId, tenantId, db);
  if (payload.reportsToId) await assertReferencedReportsTo(payload.reportsToId, tenantId, db, id);

  logger.info({ tenantId, userId: ctx.userId, positionId: id }, "applying UPDATE position");

  return db.position.update({
    where: { id },
    data: { ...positionDataFromPayload(payload), version: { increment: 1 } },
    select: positionSelect,
  });
}

export async function _applySoftDeletePosition(
  id: string,
  tenantId: string,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.position.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: {
      id: true,
      _count: { select: { assignments: { where: { deletedAt: null, isCurrent: true } } } },
    },
  });
  if (!existing) throw new PositionError("Position not found", 404, "NOT_FOUND");
  if (existing._count.assignments > 0) {
    throw new PositionError(
      "Cannot delete a position that still has a current assignment",
      400,
      "HAS_ACTIVE_ASSIGNMENTS",
    );
  }

  logger.info({ tenantId, userId: ctx.userId, positionId: id }, "applying DELETE position");

  return db.position.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: positionSelect,
  });
}

// ─── Public read helpers ────────────────────────────────────────────────

export async function publicGetPosition(id: string, publicTenantIds: string[]) {
  if (publicTenantIds.length === 0) return null;
  return prisma.position.findFirst({
    where: { id, tenantId: { in: publicTenantIds }, deletedAt: null, isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      organization: { select: { id: true, name: true, acronym: true } },
      type: { select: { id: true, name: true } },
      reportsTo: { select: { id: true, title: true } },
      assignments: {
        where: { deletedAt: null },
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
        take: 20,
        select: {
          startDate: true,
          endDate: true,
          isCurrent: true,
          person: {
            select: { id: true, firstName: true, lastName: true, honorific: true },
          },
        },
      },
    },
  });
}
