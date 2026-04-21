import type { Prisma, Tenant } from "~/generated/prisma/client";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import type {
  PaginatedQueryOptions,
  ServiceContext,
  TenantServiceContext,
} from "~/utils/types.server";

// Slugs reserved for framework/system routes — never hand these out to tenants.
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "auth",
  "login",
  "logout",
  "signup",
  "onboarding",
  "verify",
  "forgot-password",
  "reset-password",
  "change-expired-password",
  "accept-invite",
  "2fa-setup",
  "2fa-verify",
  "2fa-recovery",
  "home",
  "resources",
  "system",
  "_health",
]);

export type CreateTenantInput = {
  name: string;
  slug?: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  address: string;
  logoUrl?: string | null;
  brandTheme?: string;
  subscriptionPlan?: string;
};

export type UpdateTenantInput = Partial<Omit<CreateTenantInput, "slug">> & {
  slug?: string;
};

// ─── Slug helpers ────────────────────────────────────────

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "tenant";
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = RESERVED_SLUGS.has(base) ? `${base}-1` : base;
  let suffix = 2;
  while (await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

// ─── Read ────────────────────────────────────────────────

export async function listTenants(): Promise<Tenant[]> {
  return prisma.tenant.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function listTenantsPaginated(options: PaginatedQueryOptions) {
  const where: Prisma.TenantWhereInput = {
    deletedAt: null,
    ...(options.where as Prisma.TenantWhereInput | undefined),
  };
  const orderBy: Prisma.TenantOrderByWithRelationInput[] = options.orderBy?.length
    ? (options.orderBy as Prisma.TenantOrderByWithRelationInput[])
    : [{ name: "asc" }];

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    items,
    meta: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.ceil(total / options.pageSize),
    },
  };
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  return prisma.tenant.findFirst({ where: { id, deletedAt: null } });
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  return prisma.tenant.findFirst({ where: { slug, deletedAt: null } });
}

/**
 * Fetch a tenant with user + role counts for the detail page and the delete
 * guard. Returns `null` when the tenant is missing or soft-deleted.
 */
export async function getTenantWithCounts(id: string) {
  return prisma.tenant.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          users: { where: { deletedAt: null } },
          roles: true,
        },
      },
    },
  });
}

/**
 * Same as `listTenantsPaginated` but includes user + role counts per row.
 * Used by the Tenants admin list so the table can surface member totals
 * without a follow-up query.
 */
export async function listTenantsPaginatedWithCounts(options: PaginatedQueryOptions) {
  const where: Prisma.TenantWhereInput = {
    deletedAt: null,
    ...(options.where as Prisma.TenantWhereInput | undefined),
  };
  const orderBy: Prisma.TenantOrderByWithRelationInput[] = options.orderBy?.length
    ? (options.orderBy as Prisma.TenantOrderByWithRelationInput[])
    : [{ name: "asc" }];

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      include: {
        _count: {
          select: {
            users: { where: { deletedAt: null } },
            roles: true,
          },
        },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    items,
    meta: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.ceil(total / options.pageSize),
    },
  };
}

// ─── Write ───────────────────────────────────────────────

export async function createTenant(input: CreateTenantInput, ctx: ServiceContext): Promise<Tenant> {
  const slug = input.slug ?? (await generateUniqueSlug(input.name));

  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug,
      email: input.email,
      phone: input.phone,
      city: input.city,
      state: input.state,
      address: input.address,
      logoUrl: input.logoUrl ?? null,
      brandTheme: input.brandTheme ?? "",
      subscriptionPlan: input.subscriptionPlan ?? "free",
    },
  });

  await writeAudit({
    tenantId: tenant.id,
    userId: ctx.userId,
    action: "TENANT_CREATE",
    entityType: "tenant",
    entityId: tenant.id,
    description: `Created tenant "${tenant.name}"`,
    metadata: { slug: tenant.slug },
  });

  emitDomainEvent(tenant.id, "tenant.created", {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
  });

  return tenant;
}

export async function updateTenant(
  id: string,
  input: UpdateTenantInput,
  ctx: TenantServiceContext,
): Promise<Tenant> {
  const existing = await prisma.tenant.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, slug: true },
  });
  if (!existing) throw new Error("Tenant not found");

  if (input.slug && input.slug !== existing.slug) {
    if (RESERVED_SLUGS.has(input.slug)) {
      throw new Error(`Slug "${input.slug}" is reserved`);
    }
    const conflict = await prisma.tenant.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (conflict && conflict.id !== id) {
      throw new Error(`Slug "${input.slug}" is already taken`);
    }
  }

  const tenant = await prisma.tenant.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
      ...(input.brandTheme !== undefined && { brandTheme: input.brandTheme }),
      ...(input.subscriptionPlan !== undefined && {
        subscriptionPlan: input.subscriptionPlan,
      }),
    },
  });

  await writeAudit({
    tenantId: tenant.id,
    userId: ctx.userId,
    action: "TENANT_UPDATE",
    entityType: "tenant",
    entityId: tenant.id,
    description: `Updated tenant "${tenant.name}"`,
    metadata: JSON.parse(JSON.stringify(input)),
  });

  emitDomainEvent(tenant.id, "tenant.updated", {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
  });

  return tenant;
}

export async function deleteTenant(id: string, ctx: TenantServiceContext): Promise<void> {
  const existing = await prisma.tenant.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!existing) throw new Error("Tenant not found");

  await prisma.tenant.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await writeAudit({
    tenantId: id,
    userId: ctx.userId,
    action: "TENANT_DELETE",
    entityType: "tenant",
    entityId: id,
    description: `Soft-deleted tenant "${existing.name}"`,
  });

  emitDomainEvent(id, "tenant.deleted", { id, name: existing.name });
}
