import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import type { PaginatedQueryOptions } from "~/utils/types.server";

// ─── Error ────────────────────────────────────────────────

export class ReferenceDataError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "ReferenceDataError";
    this.status = status;
    this.code = code;
  }
}

function handleDuplicate(entity: string): never {
  throw new ReferenceDataError(`A ${entity} with this code already exists`, 400, "DUPLICATE_CODE");
}

// The reference tables are one shared set, so a code is unique across the
// whole table. Checked here rather than by a database constraint: databases
// that predate the shared set hold one copy per tenant until the seed's
// `mergeDuplicateReferenceData` step has collapsed them.
const codeHolders = {
  title: (code: string) => prisma.title.findFirst({ where: { code }, select: { id: true } }),
  organizationType: (code: string) =>
    prisma.organizationType.findFirst({ where: { code }, select: { id: true } }),
  positionType: (code: string) =>
    prisma.positionType.findFirst({ where: { code }, select: { id: true } }),
  regionalGroup: (code: string) =>
    prisma.regionalGroup.findFirst({ where: { code }, select: { id: true } }),
  memberState: (code: string) =>
    prisma.memberState.findFirst({ where: { abbreviation: code }, select: { id: true } }),
};

async function assertCodeAvailable(
  model: keyof typeof codeHolders,
  entity: string,
  code: string,
  exceptId?: string,
) {
  const holder = await codeHolders[model](code);
  if (holder && holder.id !== exceptId) handleDuplicate(entity);
}

// ─── Input types ──────────────────────────────────────────

export interface CreateTitleInput {
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}
export type UpdateTitleInput = CreateTitleInput;

export interface CreateOrganizationTypeInput {
  code: string;
  name: string;
  level: number;
  description?: string | null;
  sortOrder?: number;
}
export type UpdateOrganizationTypeInput = CreateOrganizationTypeInput;

export interface CreatePositionTypeInput {
  code: string;
  name: string;
  description?: string | null;
  hierarchyLevel?: number | null;
}
export type UpdatePositionTypeInput = CreatePositionTypeInput;

export interface CreateRegionalGroupInput {
  code: string;
  name: string;
  description?: string | null;
}
export type UpdateRegionalGroupInput = CreateRegionalGroupInput;

export interface CreateMemberStateInput {
  fullName: string;
  abbreviation: string;
  dateJoined: string; // ISO date
  isActive?: boolean;
  predecessorOrg?: string | null;
  notes?: string | null;
  regionIds?: string[];
}
export type UpdateMemberStateInput = CreateMemberStateInput;

// ─── Titles ───────────────────────────────────────────────

export async function listTitles(filter?: { isActive?: boolean }) {
  return prisma.title.findMany({
    where: { ...(filter?.isActive !== undefined && { isActive: filter.isActive }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listTitlesPaginated(options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.TitleWhereInput = {
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.title.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.TitleOrderByWithRelationInput[] | undefined) ?? [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.title.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getTitle(id: string) {
  const title = await prisma.title.findFirst({ where: { id } });
  if (!title) throw new ReferenceDataError("Title not found", 404, "NOT_FOUND");
  return title;
}

export async function createTitle(input: CreateTitleInput) {
  await assertCodeAvailable("title", "title", input.code.toUpperCase());
  return await prisma.title.create({
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateTitle(id: string, input: UpdateTitleInput) {
  await getTitle(id);
  await assertCodeAvailable("title", "title", input.code.toUpperCase(), id);
  return await prisma.title.update({
    where: { id },
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
}

export async function deleteTitle(id: string) {
  await getTitle(id);
  return prisma.title.delete({ where: { id } });
}

// ─── Organization Types ───────────────────────────────────

export async function listOrganizationTypesPaginated(options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.OrganizationTypeWhereInput = {
    deletedAt: null,
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.organizationType.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.OrganizationTypeOrderByWithRelationInput[] | undefined) ?? [
        { level: "asc" },
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.organizationType.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getOrganizationType(id: string) {
  const row = await prisma.organizationType.findFirst({
    where: { id, deletedAt: null },
  });
  if (!row) throw new ReferenceDataError("Organization type not found", 404, "NOT_FOUND");
  return row;
}

export async function createOrganizationType(input: CreateOrganizationTypeInput) {
  await assertCodeAvailable("organizationType", "organization type", input.code.toUpperCase());
  return await prisma.organizationType.create({
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      level: input.level,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateOrganizationType(id: string, input: UpdateOrganizationTypeInput) {
  await getOrganizationType(id);
  await assertCodeAvailable("organizationType", "organization type", input.code.toUpperCase(), id);
  return await prisma.organizationType.update({
    where: { id },
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      level: input.level,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function deleteOrganizationType(id: string) {
  await getOrganizationType(id);
  return prisma.organizationType.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Position Types ───────────────────────────────────────

export async function listPositionTypesPaginated(options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.PositionTypeWhereInput = {
    deletedAt: null,
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.positionType.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.PositionTypeOrderByWithRelationInput[] | undefined) ?? [
        { hierarchyLevel: "asc" },
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.positionType.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getPositionType(id: string) {
  const row = await prisma.positionType.findFirst({
    where: { id, deletedAt: null },
  });
  if (!row) throw new ReferenceDataError("Position type not found", 404, "NOT_FOUND");
  return row;
}

export async function createPositionType(input: CreatePositionTypeInput) {
  await assertCodeAvailable("positionType", "position type", input.code.toUpperCase());
  return await prisma.positionType.create({
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
      hierarchyLevel: input.hierarchyLevel ?? null,
    },
  });
}

export async function updatePositionType(id: string, input: UpdatePositionTypeInput) {
  await getPositionType(id);
  await assertCodeAvailable("positionType", "position type", input.code.toUpperCase(), id);
  return await prisma.positionType.update({
    where: { id },
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
      hierarchyLevel: input.hierarchyLevel ?? null,
    },
  });
}

export async function deletePositionType(id: string) {
  await getPositionType(id);
  return prisma.positionType.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Regional Groups ──────────────────────────────────────

export async function listRegionalGroups() {
  return prisma.regionalGroup.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function listRegionalGroupsPaginated(options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.RegionalGroupWhereInput = {
    deletedAt: null,
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.regionalGroup.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.RegionalGroupOrderByWithRelationInput[] | undefined) ?? [
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.regionalGroup.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getRegionalGroup(id: string) {
  const row = await prisma.regionalGroup.findFirst({
    where: { id, deletedAt: null },
  });
  if (!row) throw new ReferenceDataError("Regional group not found", 404, "NOT_FOUND");
  return row;
}

export async function createRegionalGroup(input: CreateRegionalGroupInput) {
  await assertCodeAvailable("regionalGroup", "regional group", input.code.toUpperCase());
  return await prisma.regionalGroup.create({
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
    },
  });
}

export async function updateRegionalGroup(id: string, input: UpdateRegionalGroupInput) {
  await getRegionalGroup(id);
  await assertCodeAvailable("regionalGroup", "regional group", input.code.toUpperCase(), id);
  return await prisma.regionalGroup.update({
    where: { id },
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
    },
  });
}

export async function deleteRegionalGroup(id: string) {
  await getRegionalGroup(id);
  return prisma.regionalGroup.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Member States ────────────────────────────────────────

export async function listMemberStatesPaginated(options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.MemberStateWhereInput = {
    deletedAt: null,
    ...(search && {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { abbreviation: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.memberState.findMany({
      where: filter,
      include: {
        regions: {
          include: { regionalGroup: { select: { id: true, name: true, code: true } } },
        },
      },
      orderBy: (orderBy as Prisma.MemberStateOrderByWithRelationInput[] | undefined) ?? [
        { fullName: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.memberState.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getMemberState(id: string) {
  const row = await prisma.memberState.findFirst({
    where: { id, deletedAt: null },
    include: {
      regions: {
        include: { regionalGroup: { select: { id: true, name: true, code: true } } },
      },
    },
  });
  if (!row) throw new ReferenceDataError("Member state not found", 404, "NOT_FOUND");
  return row;
}

export async function createMemberState(input: CreateMemberStateInput) {
  await assertCodeAvailable("memberState", "member state", input.abbreviation.toUpperCase());
  return await prisma.memberState.create({
    data: {
      fullName: input.fullName,
      abbreviation: input.abbreviation.toUpperCase(),
      dateJoined: new Date(input.dateJoined),
      isActive: input.isActive ?? true,
      predecessorOrg: input.predecessorOrg ?? null,
      notes: input.notes ?? null,
      regions: input.regionIds?.length
        ? { create: input.regionIds.map((regionalGroupId) => ({ regionalGroupId })) }
        : undefined,
    },
  });
}

export async function updateMemberState(id: string, input: UpdateMemberStateInput) {
  await getMemberState(id);
  await assertCodeAvailable("memberState", "member state", input.abbreviation.toUpperCase(), id);
  // Replace regions wholesale — simpler than diffing and keeps the UI honest.
  return await prisma.$transaction(async (tx) => {
    await tx.memberStateRegion.deleteMany({ where: { memberStateId: id } });
    return tx.memberState.update({
      where: { id },
      data: {
        fullName: input.fullName,
        abbreviation: input.abbreviation.toUpperCase(),
        dateJoined: new Date(input.dateJoined),
        isActive: input.isActive ?? true,
        predecessorOrg: input.predecessorOrg ?? null,
        notes: input.notes ?? null,
        regions: input.regionIds?.length
          ? { create: input.regionIds.map((regionalGroupId) => ({ regionalGroupId })) }
          : undefined,
      },
    });
  });
}

export async function deleteMemberState(id: string) {
  await getMemberState(id);
  return prisma.memberState.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Counts for dashboard ─────────────────────────────────

export async function getReferenceDataCounts() {
  const [titles, organizationTypes, positionTypes, regionalGroups, memberStates] =
    await Promise.all([
      prisma.title.count(),
      prisma.organizationType.count({ where: { deletedAt: null } }),
      prisma.positionType.count({ where: { deletedAt: null } }),
      prisma.regionalGroup.count({ where: { deletedAt: null } }),
      prisma.memberState.count({ where: { deletedAt: null } }),
    ]);
  return {
    titles,
    organizationTypes,
    positionTypes,
    regionalGroups,
    memberStates,
  };
}
