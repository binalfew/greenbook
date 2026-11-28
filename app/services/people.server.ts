import type { Prisma } from "~/generated/prisma/client.js";
import { _applyCreateAssignment } from "~/services/position-assignments.server";
import { prisma } from "~/utils/db/db.server";
import { normaliseSearchTerm } from "~/utils/db/search.server";
import { logger } from "~/utils/monitoring/logger.server";
import { statPhoto } from "~/utils/photo-storage.server";
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
  photoId: true,
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

async function assertReferencedMemberState(memberStateId: string, db: Db) {
  const row = await db.memberState.findFirst({
    where: { id: memberStateId, deletedAt: null },
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
    officeEmail: payload.officeEmail ?? null,
    officePhone: payload.officePhone ?? null,
    bio: payload.bio ?? null,
    memberStateId: payload.memberStateId ?? null,
    languages: payload.languages ?? [],
    showEmail: payload.showEmail ?? false,
    showPhone: payload.showPhone ?? false,
  };
}

// The photo a payload asks for: `undefined` leaves the record's photo alone,
// `null` removes it. A photo that is gone or belongs to another tenant is
// treated as "leave alone" rather than failing the whole change.
async function photoIdFromPayload(payload: PersonPayload, tenantId: string, db: Db) {
  if (!payload.photoId) return payload.photoId;
  const photo = await statPhoto(payload.photoId, db);
  return photo?.tenantId === tenantId ? photo.id : undefined;
}

// ─── Internal writers (called only from directory-changes engine) ───────

export async function _applyCreatePerson(
  tenantId: string,
  payload: PersonPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  if (payload.memberStateId) await assertReferencedMemberState(payload.memberStateId, db);

  logger.info(
    { tenantId, userId: ctx.userId, firstName: payload.firstName, lastName: payload.lastName },
    "applying CREATE person",
  );

  const created = await db.person.create({
    data: {
      tenantId,
      ...personDataFromPayload(payload),
      photoId: await photoIdFromPayload(payload, tenantId, db),
    },
    select: personSelect,
  });

  // If the payload carries an initial-assignment block, create the
  // PositionAssignment inside the same transaction. _applyCreateAssignment
  // checks the references; if the position isn't reachable, it throws and the outer
  // transaction rolls back — the person doesn't get created alone.
  if (payload.initialAssignment) {
    await _applyCreateAssignment(
      tenantId,
      {
        positionId: payload.initialAssignment.positionId,
        personId: created.id,
        startDate: payload.initialAssignment.startDate,
        endDate: null,
        notes: payload.initialAssignment.notes ?? null,
      },
      ctx,
      tx,
    );
  }

  return created;
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

  if (payload.memberStateId) await assertReferencedMemberState(payload.memberStateId, db);

  logger.info({ tenantId, userId: ctx.userId, personId: id }, "applying UPDATE person");

  return db.person.update({
    where: { id },
    data: {
      ...personDataFromPayload(payload),
      photoId: await photoIdFromPayload(payload, tenantId, db),
      version: { increment: 1 },
    },
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
  officeEmail: string | null;
  officePhone: string | null;
  bio: string | null;
  photoId: string | null;
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
  officeEmail: string | null;
  officePhone: string | null;
  bio: string | null;
  photoId: string | null;
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
    // Official contact is not personal PII — surface it whenever present.
    officeEmail: row.officeEmail,
    officePhone: row.officePhone,
    bio: row.bio,
    photoId: row.photoId,
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

  // Search matches the person (name/bio) OR their current post — position
  // title and the organization it sits in — so "search by position"
  // (post-demo feedback) surfaces the person currently holding it.
  const searchFilter: Prisma.PersonWhereInput = search
    ? {
        OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          { bio: { contains: search, mode: "insensitive" as const } },
          {
            assignments: {
              some: {
                deletedAt: null,
                isCurrent: true,
                position: {
                  deletedAt: null,
                  isActive: true,
                  OR: [
                    { title: { contains: search, mode: "insensitive" as const } },
                    {
                      // Guard the nested org against soft-deleted rows — otherwise
                      // searching a removed organization's name would still surface
                      // the people whose current post sits under it.
                      organization: {
                        deletedAt: null,
                        OR: [
                          { name: { contains: search, mode: "insensitive" as const } },
                          { acronym: { contains: search, mode: "insensitive" as const } },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
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
        officeEmail: true,
        officePhone: true,
        bio: true,
        photoId: true,
        languages: true,
        showEmail: true,
        showPhone: true,
        memberState: { select: { id: true, fullName: true, abbreviation: true } },
        assignments: {
          // A soft-deleted or deactivated position must never surface as a
          // current role (matches publicGetPosition's isActive convention).
          where: {
            deletedAt: null,
            isCurrent: true,
            position: { deletedAt: null, isActive: true },
          },
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

export type PublicPersonTimelineEntry = {
  id: string;
  startDate: Date;
  endDate: Date | null;
  isCurrent: boolean;
  position: {
    id: string;
    title: string;
    organization: { id: string; name: string; acronym: string | null };
  };
};

export type PublicReportsChainEntry = {
  positionId: string;
  positionTitle: string;
  organization: { id: string; name: string; acronym: string | null };
  holder: {
    id: string;
    firstName: string;
    lastName: string;
    honorific: string | null;
  } | null;
};

// Detail fetch includes the full assignment history for the timeline UI.
// Caps at 50 to match `publicGetOrganization`'s positions ceiling; a
// person with more than 50 recorded posts needs its own pagination route.
const PUBLIC_PERSON_HISTORY_TAKE = 50;

// Cap chain depth so a data bug (cycle) can't hang the loader. Realistic
// AU chains top out around 5-6 hops; 10 is slack.
const PUBLIC_REPORTS_CHAIN_MAX_DEPTH = 10;

// Walk up Position.reportsToId from the given starting position (exclusive)
// and collect each ancestor + its current holder. Restricted to
// `publicTenantIds` so the chain never leaks into a non-public tenant.
// Returns the chain in top-down order: topmost ancestor first, direct
// manager last. Empty array if there's no upward hop or starting position
// can't be resolved within the public tenant set.
async function buildReportsChain(
  startingPositionId: string,
  publicTenantIds: string[],
): Promise<PublicReportsChainEntry[]> {
  const start = await prisma.position.findFirst({
    where: {
      id: startingPositionId,
      deletedAt: null,
      isActive: true,
    },
    select: { reportsToId: true },
  });

  const collected: PublicReportsChainEntry[] = [];
  const seen = new Set<string>([startingPositionId]);
  let nextId: string | null = start?.reportsToId ?? null;

  while (nextId && collected.length < PUBLIC_REPORTS_CHAIN_MAX_DEPTH) {
    if (seen.has(nextId)) {
      logger.warn({ nextId, startingPositionId }, "reports-to cycle detected; stopping chain walk");
      break;
    }
    seen.add(nextId);

    const pos = await prisma.position.findFirst({
      where: { id: nextId, deletedAt: null, isActive: true },
      select: {
        id: true,
        title: true,
        reportsToId: true,
        organization: { select: { id: true, name: true, acronym: true } },
        assignments: {
          where: { tenantId: { in: publicTenantIds }, deletedAt: null, isCurrent: true },
          orderBy: { startDate: "desc" },
          take: 1,
          select: {
            person: {
              select: { id: true, firstName: true, lastName: true, honorific: true },
            },
          },
        },
      },
    });
    if (!pos) break;

    collected.push({
      positionId: pos.id,
      positionTitle: pos.title,
      organization: pos.organization,
      holder: pos.assignments[0]?.person ?? null,
    });

    nextId = pos.reportsToId;
  }

  // Walk collected bottom-up (direct manager first → topmost last); reverse
  // so the component gets top-down order for rendering as an org line.
  return collected.reverse();
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
      officeEmail: true,
      officePhone: true,
      bio: true,
      photoId: true,
      languages: true,
      showEmail: true,
      showPhone: true,
      memberState: { select: { id: true, fullName: true, abbreviation: true } },
      assignments: {
        // Exclude assignments to soft-deleted or deactivated positions from
        // both the current role and the history timeline — a removed post
        // shouldn't linger on a public profile (matches the isActive
        // convention used by publicGetPosition / publicGetOrganization).
        where: { deletedAt: null, position: { deletedAt: null, isActive: true } },
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
        take: PUBLIC_PERSON_HISTORY_TAKE,
        select: {
          id: true,
          startDate: true,
          endDate: true,
          isCurrent: true,
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
  if (!row) return null;

  const stripped = stripPII({
    ...row,
    assignments: row.assignments.map((a) => ({ position: a.position })),
  });
  const history: PublicPersonTimelineEntry[] = row.assignments.map((a) => ({
    id: a.id,
    startDate: a.startDate,
    endDate: a.endDate,
    isCurrent: a.isCurrent,
    position: a.position,
  }));

  // Build the reporting chain from the current assignment's position, if any.
  const currentAssignment = row.assignments.find((a) => a.isCurrent);
  const reportsChain: PublicReportsChainEntry[] = currentAssignment
    ? await buildReportsChain(currentAssignment.position.id, publicTenantIds)
    : [];

  return { ...stripped, history, reportsChain };
}
