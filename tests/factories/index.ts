import { hash } from "bcryptjs";
import type { PrismaClient } from "../../app/generated/prisma/client.js";

// Test data factories. `buildX` functions return plain objects that callers
// spread into `prisma.X.create({ data: ... })`. `seedX` helpers do the create
// + return the live records for downstream test arrangements.

let counter = 0;
function unique() {
  return ++counter;
}

export function buildTenant(overrides?: Record<string, unknown>) {
  const n = unique();
  return {
    name: `Test Org ${n}`,
    slug: `test-org-${n}`,
    email: `org${n}@test.com`,
    phone: `+1-555-000-${String(n).padStart(4, "0")}`,
    city: "Testville",
    state: "TS",
    address: "1 Test Way",
    ...overrides,
  };
}

export function buildUser(overrides?: Record<string, unknown>) {
  const n = unique();
  return {
    email: `user${n}@test.com`,
    firstName: "Test",
    lastName: `User ${n}`,
    ...overrides,
  };
}

export function buildRole(overrides?: Record<string, unknown>) {
  const n = unique();
  return {
    name: `role-${n}`,
    description: `Test role ${n}`,
    ...overrides,
  };
}

// ─── Seed Helpers ────────────────────────────────────────

export async function seedActiveUserStatus(prisma: PrismaClient) {
  return prisma.userStatus.upsert({
    where: { code: "ACTIVE" },
    create: { code: "ACTIVE", name: "Active" },
    update: {},
  });
}

export async function seedFullScenario(prisma: PrismaClient) {
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const status = await seedActiveUserStatus(prisma);
  const passwordHash = await hash("TestPassword123!", 10);

  const user = await prisma.user.create({
    data: {
      ...buildUser(),
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
    },
  });

  const role = await prisma.role.create({
    data: {
      ...buildRole(),
      tenantId: tenant.id,
    },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: role.id,
    },
  });

  return { tenant, user, role };
}
