import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildTenant, buildUser } from "../factories";
import { prisma } from "../setup/integration-setup";

import { compare } from "bcryptjs";
import { runSeed } from "../../prisma/seed";

const DIRECTORY_FLAGS = ["FF_DIRECTORY", "FF_PUBLIC_DIRECTORY"];

// The admin login the test run hands the seed (vitest.integration.config.ts).
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL!;

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every directory and reference row in the database, whole rows, in a stable order. */
async function directorySnapshot() {
  const byId = { orderBy: { id: "asc" } } as const;
  return {
    organizations: await prisma.organization.findMany(byId),
    positions: await prisma.position.findMany(byId),
    people: await prisma.person.findMany(byId),
    assignments: await prisma.positionAssignment.findMany(byId),
    changeRequests: await prisma.changeRequest.findMany(byId),
    organizationTypes: await prisma.organizationType.findMany(byId),
    positionTypes: await prisma.positionType.findMany(byId),
    regionalGroups: await prisma.regionalGroup.findMany(byId),
    memberStates: await prisma.memberState.findMany(byId),
    memberStateRegions: await prisma.memberStateRegion.findMany({
      orderBy: [{ memberStateId: "asc" }, { regionalGroupId: "asc" }],
    }),
    titles: await prisma.title.findMany(byId),
  };
}

async function enabledTenants(key: string) {
  const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key } });
  return [...flag.enabledForTenants].sort();
}

/** How many directory records of each kind the tenant holds, deleted ones included. */
// What a tenant holds of the directory. Organizational units and positions
// are not on the list: they belong to no tenant.
async function directoryCounts(tenantId: string) {
  const where = { tenantId };
  return {
    people: await prisma.person.count({ where }),
    assignments: await prisma.positionAssignment.count({ where }),
    changeRequests: await prisma.changeRequest.count({ where }),
  };
}

const NO_DIRECTORY_RECORDS = {
  people: 0,
  assignments: 0,
  changeRequests: 0,
};

async function homeTenantSlug(email: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { tenant: { select: { slug: true } } },
  });
  return user.tenant?.slug;
}

/**
 * A working tenant with the kind of records a tenant builds up: two
 * organizations, a position, two people, an assignment, a manager and one of
 * the manager's change requests. Needs the seed to have run once.
 */
async function arrangeWorkingDirectory(tenantId: string) {
  const status = await prisma.userStatus.findUniqueOrThrow({ where: { code: "ACTIVE" } });
  const managerRole = await prisma.role.findFirstOrThrow({ where: { name: "manager" } });
  const manager = await prisma.user.create({
    data: {
      ...buildUser({ tenantId, userStatusId: status.id }),
      userRoles: { create: { roleId: managerRole.id } },
    },
  });
  const orgType = await prisma.organizationType.findFirstOrThrow({ where: { code: "DEPARTMENT" } });
  const positionType = await prisma.positionType.findFirstOrThrow();
  const root = await prisma.organization.create({
    data: { name: "Peace Fund", acronym: "PF", typeId: orgType.id },
  });
  const child = await prisma.organization.create({
    data: { name: "Secretariat", typeId: orgType.id, parentId: root.id },
  });
  const position = await prisma.position.create({
    data: { title: "Director", organizationId: child.id, typeId: positionType.id },
  });
  const person = await prisma.person.create({
    data: { tenantId, firstName: "Amina", lastName: "Diallo", languages: [] },
  });
  await prisma.person.create({
    data: {
      tenantId,
      firstName: "Removed",
      lastName: "Earlier",
      languages: [],
      deletedAt: new Date(),
    },
  });
  await prisma.positionAssignment.create({
    data: {
      tenantId,
      personId: person.id,
      positionId: position.id,
      startDate: new Date("2025-01-01"),
      isCurrent: true,
    },
  });
  await prisma.changeRequest.create({
    data: {
      tenantId,
      entityType: "ORGANIZATION",
      entityId: child.id,
      operation: "UPDATE",
      payload: { name: "Pending rename" },
      submittedById: manager.id,
    },
  });
  return { manager, person };
}

describe("running the seed", () => {
  it("gives a fresh database the system tenant, the admin and nothing else", async () => {
    await runSeed();

    const tenants = await prisma.tenant.findMany();
    expect(tenants.map((t) => t.slug)).toEqual(["system"]);
    expect(await directoryCounts(tenants[0].id)).toEqual(NO_DIRECTORY_RECORDS);
    for (const key of [...DIRECTORY_FLAGS, "FF_NOTIFICATIONS"]) {
      expect(await enabledTenants(key)).toEqual([]);
    }
    const users = await prisma.user.findMany({
      select: { email: true, userRoles: { select: { role: { select: { name: true } } } } },
    });
    expect(users).toEqual([{ email: ADMIN_EMAIL, userRoles: [{ role: { name: "admin" } }] }]);
    expect(await homeTenantSlug(ADMIN_EMAIL)).toBe("system");
    expect(await prisma.memberState.count()).toBe(55);
  });

  it("keeps organizations and positions for the admin: no other role may write or delete them", async () => {
    await runSeed();

    const holders = await prisma.rolePermission.findMany({
      where: {
        permission: {
          resource: { in: ["organization", "position"] },
          action: { in: ["write", "delete"] },
        },
      },
      select: { role: { select: { name: true } } },
    });
    expect([...new Set(holders.map((h) => h.role.name))]).toEqual(["admin"]);
    expect(holders).toHaveLength(4);
  });

  it("creates the admin with the email and password it is given", async () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", "  Root@Example.org ");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "a-password-for-root");

    await runSeed();

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "root@example.org" },
      select: { password: { select: { hash: true } } },
    });
    expect(await compare("a-password-for-root", admin.password!.hash)).toBe(true);
  });

  it.each([
    ["no email", { SEED_ADMIN_EMAIL: "" }],
    ["no password", { SEED_ADMIN_PASSWORD: "" }],
    ["a password under 8 characters", { SEED_ADMIN_PASSWORD: "short" }],
  ])("stops before writing anything when it is given %s", async (_case, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

    await expect(runSeed()).rejects.toThrow(/SEED_ADMIN_/);

    expect(await prisma.tenant.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.userStatus.count()).toBe(0);
  });

  it("empties the database before it writes: a second run leaves the baseline and nothing else", async () => {
    await runSeed();
    const working = await prisma.tenant.create({ data: buildTenant() });
    await arrangeWorkingDirectory(working.id);
    await prisma.organizationType.updateMany({
      where: { code: "UNIT" },
      data: { name: "Renamed by hand" },
    });
    for (const key of DIRECTORY_FLAGS) {
      await prisma.featureFlag.update({
        where: { key },
        data: { enabledForTenants: { push: working.id } },
      });
    }

    await runSeed();

    expect((await prisma.tenant.findMany()).map((t) => t.slug)).toEqual(["system"]);
    expect((await prisma.user.findMany()).map((u) => u.email)).toEqual([ADMIN_EMAIL]);
    const { organizations, positions, people, assignments, changeRequests } =
      await directorySnapshot();
    expect([organizations, positions, people, assignments, changeRequests]).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
    const unit = await prisma.organizationType.findFirstOrThrow({ where: { code: "UNIT" } });
    expect(unit.name).not.toBe("Renamed by hand");
    expect(await prisma.memberState.count()).toBe(55);
    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([]);
    }
  });

  it("sets the admin's password from the environment on every run", async () => {
    await runSeed();
    vi.stubEnv("SEED_ADMIN_PASSWORD", "a-different-password");

    await runSeed();

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { password: { select: { hash: true } } },
    });
    expect(await compare("a-different-password", admin.password!.hash)).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it("empties nothing when the admin login is missing", async () => {
    await runSeed();
    const working = await prisma.tenant.create({ data: buildTenant() });
    vi.stubEnv("SEED_ADMIN_PASSWORD", "");

    await expect(runSeed()).rejects.toThrow(/SEED_ADMIN_/);

    expect(await prisma.tenant.count({ where: { id: working.id } })).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });
});
