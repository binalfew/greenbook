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

export interface CreateCountryInput {
  code: string;
  name: string;
  alpha3?: string | null;
  numericCode?: string | null;
  phoneCode?: string | null;
  flag?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
export type UpdateCountryInput = CreateCountryInput;

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

export interface CreateCurrencyInput {
  code: string;
  name: string;
  symbol?: string | null;
  decimalDigits?: number;
  sortOrder?: number;
  isActive?: boolean;
}
export type UpdateCurrencyInput = CreateCurrencyInput;

// ─── Countries ────────────────────────────────────────────

export async function listCountries(tenantId: string, filter?: { isActive?: boolean }) {
  return prisma.country.findMany({
    where: { tenantId, ...(filter?.isActive !== undefined && { isActive: filter.isActive }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listCountriesPaginated(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.CountryWhereInput = {
    tenantId,
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.country.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.CountryOrderByWithRelationInput[] | undefined) ?? [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.country.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getCountry(id: string, tenantId: string) {
  const country = await prisma.country.findFirst({ where: { id, tenantId } });
  if (!country) throw new ReferenceDataError("Country not found", 404, "NOT_FOUND");
  return country;
}

export async function createCountry(input: CreateCountryInput, ctx: TenantServiceContext) {
  try {
    return await prisma.country.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        alpha3: input.alpha3 ?? null,
        numericCode: input.numericCode ?? null,
        phoneCode: input.phoneCode ?? null,
        flag: input.flag ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("country");
    throw err;
  }
}

export async function updateCountry(
  id: string,
  input: UpdateCountryInput,
  ctx: TenantServiceContext,
) {
  await getCountry(id, ctx.tenantId);
  try {
    return await prisma.country.update({
      where: { id },
      data: {
        code: input.code.toUpperCase(),
        name: input.name,
        alpha3: input.alpha3 ?? null,
        numericCode: input.numericCode ?? null,
        phoneCode: input.phoneCode ?? null,
        flag: input.flag ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("country");
    throw err;
  }
}

export async function deleteCountry(id: string, ctx: TenantServiceContext) {
  await getCountry(id, ctx.tenantId);
  return prisma.country.delete({ where: { id } });
}

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

// ─── Currencies ───────────────────────────────────────────

export async function listCurrencies(tenantId: string, filter?: { isActive?: boolean }) {
  return prisma.currency.findMany({
    where: { tenantId, ...(filter?.isActive !== undefined && { isActive: filter.isActive }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listCurrenciesPaginated(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;
  const search = where.search as string | undefined;
  const filter: Prisma.CurrencyWhereInput = {
    tenantId,
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [data, total] = await Promise.all([
    prisma.currency.findMany({
      where: filter,
      orderBy: (orderBy as Prisma.CurrencyOrderByWithRelationInput[] | undefined) ?? [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      skip,
      take: pageSize,
    }),
    prisma.currency.count({ where: filter }),
  ]);
  return { data, total };
}

export async function getCurrency(id: string, tenantId: string) {
  const currency = await prisma.currency.findFirst({ where: { id, tenantId } });
  if (!currency) throw new ReferenceDataError("Currency not found", 404, "NOT_FOUND");
  return currency;
}

export async function createCurrency(input: CreateCurrencyInput, ctx: TenantServiceContext) {
  try {
    return await prisma.currency.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        symbol: input.symbol ?? null,
        decimalDigits: input.decimalDigits ?? 2,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("currency");
    throw err;
  }
}

export async function updateCurrency(
  id: string,
  input: UpdateCurrencyInput,
  ctx: TenantServiceContext,
) {
  await getCurrency(id, ctx.tenantId);
  try {
    return await prisma.currency.update({
      where: { id },
      data: {
        code: input.code.toUpperCase(),
        name: input.name,
        symbol: input.symbol ?? null,
        decimalDigits: input.decimalDigits ?? 2,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique")) handleDuplicate("currency");
    throw err;
  }
}

export async function deleteCurrency(id: string, ctx: TenantServiceContext) {
  await getCurrency(id, ctx.tenantId);
  return prisma.currency.delete({ where: { id } });
}

// ─── Counts for dashboard ─────────────────────────────────

export async function getReferenceDataCounts(tenantId: string) {
  const [countries, titles, languages, currencies] = await Promise.all([
    prisma.country.count({ where: { tenantId } }),
    prisma.title.count({ where: { tenantId } }),
    prisma.language.count({ where: { tenantId } }),
    prisma.currency.count({ where: { tenantId } }),
  ]);
  return { countries, titles, languages, currencies };
}
