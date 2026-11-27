import type { Prisma, Tenant } from "~/generated/prisma/client";
import { clearPublicTenantIdsCache } from "~/services/public-directory.server";
import { bootstrapNewTenant } from "~/services/tenant-setup.server";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import {
  DUPLICATE_SLUG_MESSAGE,
  RESERVED_SLUG_MESSAGE,
  isReservedSlug,
} from "~/utils/reserved-slugs";
import type {
  PaginatedQueryOptions,
  ServiceContext,
  TenantServiceContext,
} from "~/utils/types.server";

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
  /**
   * Existing user to attach as the new tenant's first admin. When omitted,
   * the tenant is created with its standard roles but no admin assigned —
   * the global admin can promote users via the user-edit form.
   */
  initialAdminUserId?: string | null;
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

/**
 * A slug the tenant cannot have, for a reason the admin can fix. The message
 * is safe to show next to the slug field.
 */
export class TenantSlugError extends Error {
  constructor(public readonly reason: "reserved" | "taken") {
    super(reason === "reserved" ? RESERVED_SLUG_MESSAGE : DUPLICATE_SLUG_MESSAGE);
  }
}

// The slug column is unique across deleted tenants too, so the lookup does
// not filter on `deletedAt`.
async function assertSlugAvailable(slug: string, ownTenantId?: string): Promise<void> {
  if (isReservedSlug(slug)) throw new TenantSlugError("reserved");
  const holder = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (holder && holder.id !== ownTenantId) throw new TenantSlugError("taken");
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = isReservedSlug(base) ? `${base}-1` : base;
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
  if (input.slug) await assertSlugAvailable(input.slug);

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

  // Every new tenant gets its standard `admin` and `user` roles wired up the
  // moment it's created. The optional initialAdminUserId, when provided,
  // attaches that user as the tenant's first admin so they can sign in and
  // manage it immediately.
  await bootstrapNewTenant({
    tenantId: tenant.id,
    initialAdminUserId: input.initialAdminUserId ?? undefined,
  });

  await writeAudit({
    tenantId: tenant.id,
    userId: ctx.userId,
    action: "TENANT_CREATE",
    entityType: "tenant",
    entityId: tenant.id,
    description: `Created tenant "${tenant.name}"`,
    metadata: {
      slug: tenant.slug,
      initialAdminUserId: input.initialAdminUserId ?? null,
    },
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
    await assertSlugAvailable(input.slug, id);
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

/** A deletion refused for a reason the admin can act on. */
export class TenantDeleteError extends Error {}

export async function deleteTenant(id: string, ctx: TenantServiceContext): Promise<void> {
  const existing = await prisma.tenant.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { users: { where: { deletedAt: null } } } },
    },
  });
  if (!existing) throw new Error("Tenant not found");

  if (existing.slug === "system") {
    throw new TenantDeleteError("The system tenant cannot be deleted.");
  }
  // Also covers the acting admin's own home tenant, and means no account is
  // left pointing at a workspace that no longer exists.
  if (existing._count.users > 0) {
    throw new TenantDeleteError(
      `Cannot delete this tenant because it has ${existing._count.users} user(s). Remove all users first.`,
    );
  }

  await prisma.tenant.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  // Take the tenant's people out of cross-tenant search now, not in 5 minutes.
  clearPublicTenantIdsCache();

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
