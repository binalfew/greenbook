import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import { normaliseSearchTerm } from "~/utils/db/search.server";
import { logger } from "~/utils/monitoring/logger.server";
import type { PersonPayload } from "~/utils/schemas/directory";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

export class PersonError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "PersonError";
    this.status = status;
    this.code = code;
  }
}

const personSelect = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  honorific: true,
  email: true,
  phone: true,
  bio: true,
  photoUrl: true,
  memberStateId: true,
  languages: true,
  showEmail: true,
  showPhone: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

const personListInclude = {
  memberState: { select: { id: true, fullName: true, abbreviation: true } },
  _count: {
    select: {
      assignments: { where: { deletedAt: null, isCurrent: true } },
    },
  },
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────

export async function listPeople(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const search = normaliseSearchTerm(where.search);
  const searchFilter = search
    ? {
        OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { bio: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const memberStateFilter = where.memberStateId
    ? { memberStateId: where.memberStateId as string }
    : {};

  const filter: Prisma.PersonWhereInput = {
    tenantId,
    deletedAt: null,
    ...searchFilter,
    ...memberStateFilter,
  };

  const [data, total] = await Promise.all([
    prisma.person.findMany({
      where: filter,
      orderBy: orderBy ?? [{ lastName: "asc" }, { firstName: "asc" }],
      skip,
      take: pageSize,
      include: personListInclude,
    }),
    prisma.person.count({ where: filter }),
  ]);

  return { data, total };
}

export async function getPerson(id: string, tenantId: string) {
  const person = await prisma.person.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      memberState: { select: { id: true, fullName: true, abbreviation: true } },
      assignments: {
        where: { deletedAt: null },
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
        include: {
          position: {
            select: {
              id: true,
              title: true,
              organization: { select: { id: true, name: true, acronym: true } },
              type: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!person) throw new PersonError("Person not found", 404, "NOT_FOUND");
  return person;
}

// ─── Guards ─────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma;

async function assertReferencedMemberState(memberStateId: string, tenantId: string, db: Db) {
  const row = await db.memberState.findFirst({
    where: { id: memberStateId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new PersonError(
      "Referenced member state is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

function personDataFromPayload(payload: PersonPayload) {
  return {
    firstName: payload.firstName,
    lastName: payload.lastName,
    honorific: payload.honorific ?? null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    bio: payload.bio ?? null,
    photoUrl: payload.photoUrl ?? null,
    memberStateId: payload.memberStateId ?? null,
    languages: payload.languages ?? [],
    showEmail: payload.showEmail ?? false,
    showPhone: payload.showPhone ?? false,
  };
}

// ─── Internal writers (called only from directory-changes engine) ───────

export async function _applyCreatePerson(
  tenantId: string,
  payload: PersonPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  if (payload.memberStateId) await assertReferencedMemberState(payload.memberStateId, tenantId, db);

  logger.info(
    { tenantId, userId: ctx.userId, firstName: payload.firstName, lastName: payload.lastName },
    "applying CREATE person",
  );

  return db.person.create({
    data: { tenantId, ...personDataFromPayload(payload) },
    select: personSelect,
  });
}

export async function _applyUpdatePerson(
  id: string,
  tenantId: string,
  payload: PersonPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.person.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new PersonError("Person not found", 404, "NOT_FOUND");

  if (payload.memberStateId) await assertReferencedMemberState(payload.memberStateId, tenantId, db);

  logger.info({ tenantId, userId: ctx.userId, personId: id }, "applying UPDATE person");

  return db.person.update({
    where: { id },
    data: { ...personDataFromPayload(payload), version: { increment: 1 } },
    select: personSelect,
  });
}

export async function _applySoftDeletePerson(
  id: string,
  tenantId: string,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.person.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: {
      id: true,
      _count: { select: { assignments: { where: { deletedAt: null, isCurrent: true } } } },
    },
  });
  if (!existing) throw new PersonError("Person not found", 404, "NOT_FOUND");
  if (existing._count.assignments > 0) {
    throw new PersonError(
      "Cannot delete a person with current active position assignments",
      400,
      "HAS_ACTIVE_ASSIGNMENTS",
    );
  }

  logger.info({ tenantId, userId: ctx.userId, personId: id }, "applying DELETE person");

  return db.person.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: personSelect,
  });
}

// ─── Public read helpers (cross-tenant, opt-in gated, PII-aware) ────────

type PublicPerson = {
  id: string;
  firstName: string;
  lastName: string;
  honorific: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  photoUrl: string | null;
  languages: string[];
  memberState: { id: string; fullName: string; abbreviation: string } | null;
  currentAssignments: {
    positionId: string;
    positionTitle: string;
    organization: { id: string; name: string; acronym: string | null };
  }[];
};

function stripPII(row: {
  id: string;
  firstName: string;
  lastName: string;
  honorific: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  photoUrl: string | null;
  languages: string[];
  showEmail: boolean;
  showPhone: boolean;
  memberState: { id: string; fullName: string; abbreviation: string } | null;
  assignments?: {
    position: {
      id: string;
      title: string;
      organization: { id: string; name: string; acronym: string | null };
    };
  }[];
}): PublicPerson {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    honorific: row.honorific,
    email: row.showEmail ? row.email : null,
    phone: row.showPhone ? row.phone : null,
    bio: row.bio,
    photoUrl: row.photoUrl,
    languages: row.languages,
    memberState: row.memberState,
    currentAssignments: (row.assignments ?? []).map((a) => ({
      positionId: a.position.id,
      positionTitle: a.position.title,
      organization: a.position.organization,
    })),
  };
}

export async function publicListPeople(
  publicTenantIds: string[],
  options: { search?: string; memberStateId?: string; page?: number; pageSize?: number } = {},
) {
  if (publicTenantIds.length === 0) return { data: [], total: 0 };
  const { memberStateId, page = 1, pageSize = 20 } = options;
  const skip = (page - 1) * pageSize;
  const search = normaliseSearchTerm(options.search);

  const searchFilter = search
    ? {
        OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          { bio: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const filter: Prisma.PersonWhereInput = {
    tenantId: { in: publicTenantIds },
    deletedAt: null,
    ...searchFilter,
    ...(memberStateId ? { memberStateId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where: filter,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        honorific: true,
        email: true,
        phone: true,
        bio: true,
        photoUrl: true,
        languages: true,
        showEmail: true,
        showPhone: true,
        memberState: { select: { id: true, fullName: true, abbreviation: true } },
        assignments: {
          where: { deletedAt: null, isCurrent: true },
          take: 10,
          orderBy: { startDate: "desc" },
          select: {
            position: {
              select: {
                id: true,
                title: true,
                organization: { select: { id: true, name: true, acronym: true } },
              },
            },
          },
        },
      },
    }),
    prisma.person.count({ where: filter }),
  ]);

  return { data: rows.map(stripPII), total };
}

export async function publicGetPerson(id: string, publicTenantIds: string[]) {
  if (publicTenantIds.length === 0) return null;
  const row = await prisma.person.findFirst({
    where: { id, tenantId: { in: publicTenantIds }, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      honorific: true,
      email: true,
      phone: true,
      bio: true,
      photoUrl: true,
      languages: true,
      showEmail: true,
      showPhone: true,
      memberState: { select: { id: true, fullName: true, abbreviation: true } },
      assignments: {
        where: { deletedAt: null, isCurrent: true },
        select: {
          position: {
            select: {
              id: true,
              title: true,
              organization: { select: { id: true, name: true, acronym: true } },
            },
          },
        },
      },
    },
  });
  return row ? stripPII(row) : null;
}
