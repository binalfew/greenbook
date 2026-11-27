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
async function directoryCounts(tenantId: string) {
  const where = { tenantId };
  return {
    organizations: await prisma.organization.count({ where }),
    people: await prisma.person.count({ where }),
    positions: await prisma.position.count({ where }),
    assignments: await prisma.positionAssignment.count({ where }),
    changeRequests: await prisma.changeRequest.count({ where }),
  };
}

const NO_DIRECTORY_RECORDS = {
  organizations: 0,
  people: 0,
  positions: 0,
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
    data: { tenantId, name: "Peace Fund", acronym: "PF", typeId: orgType.id },
  });
  const child = await prisma.organization.create({
    data: { tenantId, name: "Secretariat", typeId: orgType.id, parentId: root.id },
  });
  const position = await prisma.position.create({
    data: { tenantId, title: "Director", organizationId: child.id, typeId: positionType.id },
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

  it("leaves the admin's password alone when run again with another one", async () => {
    await runSeed();
    vi.stubEnv("SEED_ADMIN_PASSWORD", "a-different-password");

    await runSeed();

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { password: { select: { hash: true } } },
    });
    expect(await compare(process.env.SEED_ADMIN_PASSWORD!, admin.password!.hash)).toBe(false);
    expect(await prisma.user.count()).toBe(1);
  });

  it("moves directory records out of an existing system tenant into the misd tenant", async () => {
    // A database seeded before the system tenant became admin-only: the
    // directory, both flags and the working accounts all sit in `system`.
    await runSeed();
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    const misd = await prisma.tenant.create({ data: buildTenant({ slug: "misd" }) });
    const { manager, person } = await arrangeWorkingDirectory(system.id);
    const photo = await prisma.personPhoto.create({
      data: {
        tenantId: system.id,
        contentType: "image/webp",
        width: 1,
        height: 1,
        size: 1,
        data: new Uint8Array([0]),
      },
    });
    await prisma.person.update({ where: { id: person.id }, data: { photoId: photo.id } });
    await prisma.featureFlag.updateMany({
      where: { key: { in: DIRECTORY_FLAGS } },
      data: { enabledForTenants: [system.id] },
    });
    const { organizations, positions, people, assignments, changeRequests } =
      await directorySnapshot();
    const inMisd = <T extends { tenantId: string }>(rows: T[]) =>
      rows.map((row) => ({ ...row, tenantId: misd.id }));

    await runSeed();

    expect(await directoryCounts(system.id)).toEqual(NO_DIRECTORY_RECORDS);
    const after = await directorySnapshot();
    expect(after.organizations).toEqual(inMisd(organizations));
    expect(after.positions).toEqual(inMisd(positions));
    expect(after.people).toEqual(inMisd(people));
    expect(after.assignments).toEqual(inMisd(assignments));
    expect(after.changeRequests).toEqual(inMisd(changeRequests));
    expect((await prisma.personPhoto.findUniqueOrThrow({ where: { id: photo.id } })).tenantId).toBe(
      misd.id,
    );
    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([misd.id]);
    }
    expect(await homeTenantSlug(manager.email)).toBe("misd");
    expect(await homeTenantSlug(ADMIN_EMAIL)).toBe("system");
  });

  it("creates no tenant to move a system tenant's directory into", async () => {
    await runSeed();
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    await arrangeWorkingDirectory(system.id);
    const before = await directorySnapshot();

    await runSeed();

    expect(await prisma.tenant.count()).toBe(1);
    expect(await directorySnapshot()).toEqual(before);
  });

  it("leaves existing directory records untouched when run again", async () => {
    await runSeed();
    const working = await prisma.tenant.create({ data: buildTenant() });
    await arrangeWorkingDirectory(working.id);
    await prisma.organizationType.updateMany({
      where: { code: "UNIT" },
      data: { name: "Renamed by hand" },
    });
    const etiopia = await prisma.memberState.findFirstOrThrow({
      where: { abbreviation: "ETH" },
    });
    await prisma.memberStateRegion.deleteMany({ where: { memberStateId: etiopia.id } });

    const before = await directorySnapshot();
    await runSeed();

    expect(await directorySnapshot()).toEqual(before);
    expect(await prisma.tenant.count()).toBe(2);
  });

  it("keeps every tenant already on a flag's enabled list when run again", async () => {
    await runSeed();
    const optedIn = await prisma.tenant.create({ data: buildTenant() });
    for (const key of [...DIRECTORY_FLAGS, "FF_NOTIFICATIONS"]) {
      await prisma.featureFlag.update({
        where: { key },
        data: { enabledForTenants: { push: optedIn.id } },
      });
    }

    await runSeed();

    for (const key of [...DIRECTORY_FLAGS, "FF_NOTIFICATIONS"]) {
      expect(await enabledTenants(key)).toEqual([optedIn.id]);
    }
  });

  it("opts the tenants that use the directory into notifications when the system tenant hands its directory over", async () => {
    await runSeed();
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    const misd = await prisma.tenant.create({ data: buildTenant({ slug: "misd" }) });
    const working = await prisma.tenant.create({ data: buildTenant() });
    const idle = await prisma.tenant.create({ data: buildTenant() });
    // The state of a database seeded before the system tenant became
    // admin-only: it is a directory tenant and nobody has notifications.
    await prisma.featureFlag.updateMany({
      where: { key: { in: DIRECTORY_FLAGS } },
      data: { enabledForTenants: [system.id, working.id] },
    });

    await runSeed();

    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([misd.id, working.id].sort());
    }
    const notified = await enabledTenants("FF_NOTIFICATIONS");
    expect(notified).toEqual([misd.id, working.id].sort());
    expect(notified).not.toContain(idle.id);
  });

  it("hands the system tenant's place on notifications to the misd tenant", async () => {
    await runSeed();
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    const misd = await prisma.tenant.create({ data: buildTenant({ slug: "misd" }) });
    await prisma.featureFlag.update({
      where: { key: "FF_NOTIFICATIONS" },
      data: { enabledForTenants: { push: system.id } },
    });

    await runSeed();

    expect(await enabledTenants("FF_NOTIFICATIONS")).toEqual([misd.id]);
  });

  it("leaves a tenant opted out of notifications by hand opted out when run again", async () => {
    await runSeed();
    const misd = await prisma.tenant.create({ data: buildTenant({ slug: "misd" }) });
    await prisma.featureFlag.update({
      where: { key: "FF_DIRECTORY" },
      data: { enabledForTenants: { push: misd.id } },
    });

    await runSeed();

    expect(await enabledTenants("FF_NOTIFICATIONS")).toEqual([]);
  });
});
