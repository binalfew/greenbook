import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

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

// ─── Input types ──────────────────────────────────────────

export interface CreateTitleInput {
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}
export type UpdateTitleInput = CreateTitleInput;

export interface CreateLanguageInput {
  code: string;
  name: string;
  nativeName?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
export type UpdateLanguageInput = CreateLanguageInput;

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

export async function listTitles(tenantId: string, filter?: { isActive?: boolean }) {
  return prisma.title.findMany({
    where: { tenantId, ...(filter?.isActive !== undefined && { isActive: filter.isActive }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listTitlesPaginated(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.TitleWhereInput = {
    tenantId,
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

export async function getTitle(id: string, tenantId: string) {
  const title = await prisma.title.findFirst({ where: { id, tenantId } });
  if (!title) throw new ReferenceDataError("Title not found", 404, "NOT_FOUND");
  return title;
}

export async function createTitle(input: CreateTitleInput, ctx: TenantServiceContext) {
  try {
    return await prisma.title.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("title");
    throw err;
  }
}

export async function updateTitle(id: string, input: UpdateTitleInput, ctx: TenantServiceContext) {
  await getTitle(id, ctx.tenantId);
  try {
    return await prisma.title.update({
      where: { id },
      data: {
        code: input.code.toUpperCase(),
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("title");
    throw err;
  }
}

export async function deleteTitle(id: string, ctx: TenantServiceContext) {
  await getTitle(id, ctx.tenantId);
  return prisma.title.delete({ where: { id } });
}

// ─── Languages ────────────────────────────────────────────

export async function listLanguages(tenantId: string, filter?: { isActive?: boolean }) {
  return prisma.language.findMany({
    where: { tenantId, ...(filter?.isActive !== undefined && { isActive: filter.isActive }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listLanguagesPaginated(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.LanguageWhereInput = {
    tenantId,
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.language.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.LanguageOrderByWithRelationInput[] | undefined) ?? [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.language.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getLanguage(id: string, tenantId: string) {
  const language = await prisma.language.findFirst({ where: { id, tenantId } });
  if (!language) throw new ReferenceDataError("Language not found", 404, "NOT_FOUND");
  return language;
}

export async function createLanguage(input: CreateLanguageInput, ctx: TenantServiceContext) {
  try {
    return await prisma.language.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toLowerCase(),
        name: input.name,
        nativeName: input.nativeName ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("language");
    throw err;
  }
}

export async function updateLanguage(
  id: string,
  input: UpdateLanguageInput,
  ctx: TenantServiceContext,
) {
  await getLanguage(id, ctx.tenantId);
  try {
    return await prisma.language.update({
      where: { id },
      data: {
        code: input.code.toLowerCase(),
        name: input.name,
        nativeName: input.nativeName ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("language");
    throw err;
  }
}

export async function deleteLanguage(id: string, ctx: TenantServiceContext) {
  await getLanguage(id, ctx.tenantId);
  return prisma.language.delete({ where: { id } });
}

// ─── Organization Types ───────────────────────────────────

export async function listOrganizationTypesPaginated(
  tenantId: string,
  options: PaginatedQueryOptions,
) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.OrganizationTypeWhereInput = {
    tenantId,
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

export async function getOrganizationType(id: string, tenantId: string) {
  const row = await prisma.organizationType.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new ReferenceDataError("Organization type not found", 404, "NOT_FOUND");
  return row;
}

export async function createOrganizationType(
  input: CreateOrganizationTypeInput,
  ctx: TenantServiceContext,
) {
  try {
    return await prisma.organizationType.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        level: input.level,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique"))
      handleDuplicate("organization type");
    throw err;
  }
}

export async function updateOrganizationType(
  id: string,
  input: UpdateOrganizationTypeInput,
  ctx: TenantServiceContext,
) {
  await getOrganizationType(id, ctx.tenantId);
  try {
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
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique"))
      handleDuplicate("organization type");
    throw err;
  }
}

export async function deleteOrganizationType(id: string, ctx: TenantServiceContext) {
  await getOrganizationType(id, ctx.tenantId);
  return prisma.organizationType.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Position Types ───────────────────────────────────────

export async function listPositionTypesPaginated(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.PositionTypeWhereInput = {
    tenantId,
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

export async function getPositionType(id: string, tenantId: string) {
  const row = await prisma.positionType.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new ReferenceDataError("Position type not found", 404, "NOT_FOUND");
  return row;
}

export async function createPositionType(
  input: CreatePositionTypeInput,
  ctx: TenantServiceContext,
) {
  try {
    return await prisma.positionType.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description ?? null,
        hierarchyLevel: input.hierarchyLevel ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("position type");
    throw err;
  }
}

export async function updatePositionType(
  id: string,
  input: UpdatePositionTypeInput,
  ctx: TenantServiceContext,
) {
  await getPositionType(id, ctx.tenantId);
  try {
    return await prisma.positionType.update({
      where: { id },
      data: {
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description ?? null,
        hierarchyLevel: input.hierarchyLevel ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("position type");
    throw err;
  }
}

export async function deletePositionType(id: string, ctx: TenantServiceContext) {
  await getPositionType(id, ctx.tenantId);
  return prisma.positionType.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Regional Groups ──────────────────────────────────────

export async function listRegionalGroups(tenantId: string) {
  return prisma.regionalGroup.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function listRegionalGroupsPaginated(
  tenantId: string,
  options: PaginatedQueryOptions,
) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.RegionalGroupWhereInput = {
    tenantId,
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

export async function getRegionalGroup(id: string, tenantId: string) {
  const row = await prisma.regionalGroup.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new ReferenceDataError("Regional group not found", 404, "NOT_FOUND");
  return row;
}

export async function createRegionalGroup(
  input: CreateRegionalGroupInput,
  ctx: TenantServiceContext,
) {
  try {
    return await prisma.regionalGroup.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("regional group");
    throw err;
  }
}

export async function updateRegionalGroup(
  id: string,
  input: UpdateRegionalGroupInput,
  ctx: TenantServiceContext,
) {
  await getRegionalGroup(id, ctx.tenantId);
  try {
    return await prisma.regionalGroup.update({
      where: { id },
      data: {
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("regional group");
    throw err;
  }
}

export async function deleteRegionalGroup(id: string, ctx: TenantServiceContext) {
  await getRegionalGroup(id, ctx.tenantId);
  return prisma.regionalGroup.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Member States ────────────────────────────────────────

export async function listMemberStatesPaginated(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.MemberStateWhereInput = {
    tenantId,
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

export async function getMemberState(id: string, tenantId: string) {
  const row = await prisma.memberState.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      regions: {
        include: { regionalGroup: { select: { id: true, name: true, code: true } } },
      },
    },
  });
  if (!row) throw new ReferenceDataError("Member state not found", 404, "NOT_FOUND");
  return row;
}

export async function createMemberState(input: CreateMemberStateInput, ctx: TenantServiceContext) {
  try {
    return await prisma.memberState.create({
      data: {
        tenantId: ctx.tenantId,
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
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("member state");
    throw err;
  }
}

export async function updateMemberState(
  id: string,
  input: UpdateMemberStateInput,
  ctx: TenantServiceContext,
) {
  await getMemberState(id, ctx.tenantId);
  try {
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
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("member state");
    throw err;
  }
}

export async function deleteMemberState(id: string, ctx: TenantServiceContext) {
  await getMemberState(id, ctx.tenantId);
  return prisma.memberState.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ─── Counts for dashboard ─────────────────────────────────

export async function getReferenceDataCounts(tenantId: string) {
  const [titles, languages, organizationTypes, positionTypes, regionalGroups, memberStates] =
    await Promise.all([
      prisma.title.count({ where: { tenantId } }),
      prisma.language.count({ where: { tenantId } }),
      prisma.organizationType.count({ where: { tenantId, deletedAt: null } }),
      prisma.positionType.count({ where: { tenantId, deletedAt: null } }),
      prisma.regionalGroup.count({ where: { tenantId, deletedAt: null } }),
      prisma.memberState.count({ where: { tenantId, deletedAt: null } }),
    ]);
  return {
    titles,
    languages,
    organizationTypes,
    positionTypes,
    regionalGroups,
    memberStates,
  };
}
