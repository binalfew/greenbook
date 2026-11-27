import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildTenant } from "../factories";
import { prisma } from "../setup/integration-setup";

import { runSeed } from "../../prisma/seed";

const DIRECTORY_FLAGS = ["FF_DIRECTORY", "FF_PUBLIC_DIRECTORY"];

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
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

describe("running the seed", () => {
  it("leaves the system tenant of a fresh database without a directory", async () => {
    await runSeed();

    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    expect(await directoryCounts(system.id)).toEqual(NO_DIRECTORY_RECORDS);
    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).not.toContain(system.id);
    }
    expect(await homeTenantSlug("admin@africanunion.org")).toBe("system");
  });

  it("gives a fresh database a working demo tenant with the starter directory", async () => {
    await runSeed();

    const demo = await prisma.tenant.findFirstOrThrow({ where: { slug: "demo" } });
    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([demo.id]);
    }
    const orgs = await prisma.organization.findMany({ where: { tenantId: demo.id } });
    expect(orgs.map((o) => o.acronym).sort()).toEqual(["AU", "AUC", "ETTIM", "ODC", "OOC", "PAPS"]);
    expect(await prisma.memberState.count()).toBe(55);
    expect(await prisma.person.count({ where: { tenantId: demo.id } })).toBeGreaterThan(0);
    expect(
      await prisma.positionAssignment.count({ where: { tenantId: demo.id, isCurrent: true } }),
    ).toBeGreaterThan(0);

    for (const [email, role] of [
      ["focal@africanunion.org", "focal"],
      ["manager@africanunion.org", "manager"],
    ]) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { tenantId: true, userRoles: { select: { role: { select: { name: true } } } } },
      });
      expect(user.tenantId).toBe(demo.id);
      expect(user.userRoles.map((ur) => ur.role.name)).toEqual([role]);
    }
  });

  it("uses the misd tenant as the demo tenant when it is already provisioned", async () => {
    const misd = await prisma.tenant.create({ data: buildTenant({ slug: "misd" }) });

    await runSeed();

    expect(await prisma.tenant.count({ where: { slug: "demo" } })).toBe(0);
    expect(await prisma.organization.count({ where: { tenantId: misd.id } })).toBe(6);
    expect(await homeTenantSlug("manager@africanunion.org")).toBe("misd");
  });

  it("moves directory records out of an existing system tenant into the demo tenant", async () => {
    // A database seeded before the system tenant became admin-only: the
    // directory, both flags and the working accounts all sit in `system`.
    await runSeed();
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    const demo = await prisma.tenant.findFirstOrThrow({ where: { slug: "demo" } });
    const manager = await prisma.user.findUniqueOrThrow({
      where: { email: "manager@africanunion.org" },
    });
    const anOrg = await prisma.organization.findFirstOrThrow({ where: { acronym: "PAPS" } });
    await prisma.changeRequest.create({
      data: {
        tenantId: demo.id,
        entityType: "ORGANIZATION",
        entityId: anOrg.id,
        operation: "UPDATE",
        payload: { name: "Pending rename" },
        submittedById: manager.id,
      },
    });
    const where = { tenantId: demo.id };
    const data = { tenantId: system.id };
    await prisma.organization.updateMany({ where, data });
    await prisma.person.updateMany({ where, data });
    await prisma.position.updateMany({ where, data });
    await prisma.positionAssignment.updateMany({ where, data });
    await prisma.changeRequest.updateMany({ where, data });
    await prisma.user.updateMany({
      where: { email: { in: ["focal@africanunion.org", "manager@africanunion.org"] } },
      data,
    });
    await prisma.featureFlag.updateMany({
      where: { key: { in: DIRECTORY_FLAGS } },
      data: { enabledForTenants: [system.id] },
    });
    const { organizations, positions, people, assignments, changeRequests } =
      await directorySnapshot();
    const inDemo = <T extends { tenantId: string }>(rows: T[]) =>
      rows.map((row) => ({ ...row, tenantId: demo.id }));

    await runSeed();

    expect(await directoryCounts(system.id)).toEqual(NO_DIRECTORY_RECORDS);
    const after = await directorySnapshot();
    expect(after.organizations).toEqual(inDemo(organizations));
    expect(after.positions).toEqual(inDemo(positions));
    expect(after.people).toEqual(inDemo(people));
    expect(after.assignments).toEqual(inDemo(assignments));
    expect(after.changeRequests).toEqual(inDemo(changeRequests));
    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([demo.id]);
    }
    expect(await homeTenantSlug("focal@africanunion.org")).toBe("demo");
    expect(await homeTenantSlug("manager@africanunion.org")).toBe("demo");
  });

  it("leaves existing directory records untouched when run again", async () => {
    await runSeed();
    const demo = await prisma.tenant.findFirstOrThrow({ where: { slug: "demo" } });
    const manager = await prisma.user.findUniqueOrThrow({
      where: { email: "manager@africanunion.org" },
    });

    // The kind of edits a tenant makes after the first seed.
    const paps = await prisma.organization.findFirstOrThrow({ where: { acronym: "PAPS" } });
    const au = await prisma.organization.findFirstOrThrow({ where: { acronym: "AU" } });
    await prisma.organization.update({
      where: { id: paps.id },
      data: { name: "Political Affairs, Peace and Security", parentId: au.id, sortOrder: 9 },
    });
    const added = await prisma.organization.create({
      data: { tenantId: demo.id, name: "Added by hand", typeId: paps.typeId, parentId: au.id },
    });
    const [edited, removed] = await prisma.person.findMany({ orderBy: { id: "asc" }, take: 2 });
    await prisma.person.update({
      where: { id: edited.id },
      data: { bio: "Edited by hand", showEmail: !edited.showEmail },
    });
    const ended = await prisma.positionAssignment.findFirstOrThrow({
      where: { personId: removed.id },
    });
    await prisma.positionAssignment.update({
      where: { id: ended.id },
      data: { isCurrent: false, endDate: new Date("2026-01-31") },
    });
    await prisma.person.update({ where: { id: removed.id }, data: { deletedAt: new Date() } });
    await prisma.person.create({
      data: { tenantId: demo.id, firstName: "Added", lastName: "Byhand", languages: [] },
    });
    await prisma.changeRequest.create({
      data: {
        tenantId: demo.id,
        entityType: "ORGANIZATION",
        entityId: added.id,
        operation: "UPDATE",
        payload: { name: "Pending rename" },
        submittedById: manager.id,
      },
    });
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
  });

  it("keeps every tenant already on a flag's enabled list when run again", async () => {
    await runSeed();
    const demo = await prisma.tenant.findFirstOrThrow({ where: { slug: "demo" } });
    const optedIn = await prisma.tenant.create({ data: buildTenant() });
    for (const key of [...DIRECTORY_FLAGS, "FF_NOTIFICATIONS"]) {
      await prisma.featureFlag.update({
        where: { key },
        data: { enabledForTenants: { push: optedIn.id } },
      });
    }

    await runSeed();

    for (const key of [...DIRECTORY_FLAGS, "FF_NOTIFICATIONS"]) {
      expect(await enabledTenants(key)).toEqual([optedIn.id, demo.id].sort());
    }
  });

  it("opts the tenants that use the directory into notifications when no tenant has them yet", async () => {
    await runSeed();
    const demo = await prisma.tenant.findFirstOrThrow({ where: { slug: "demo" } });
    const working = await prisma.tenant.create({ data: buildTenant() });
    const idle = await prisma.tenant.create({ data: buildTenant() });
    await prisma.featureFlag.update({
      where: { key: "FF_DIRECTORY" },
      data: { enabledForTenants: { push: working.id } },
    });
    // The state databases seeded before this step are in.
    await prisma.featureFlag.update({
      where: { key: "FF_NOTIFICATIONS" },
      data: { enabledForTenants: { set: [] } },
    });

    await runSeed();

    const notified = await enabledTenants("FF_NOTIFICATIONS");
    expect(notified).toEqual([demo.id, working.id].sort());
    expect(notified).not.toContain(idle.id);
  });

  it("leaves a tenant opted out of notifications by hand opted out when run again", async () => {
    await runSeed();
    const demo = await prisma.tenant.findFirstOrThrow({ where: { slug: "demo" } });
    const optedOut = await prisma.tenant.create({ data: buildTenant() });
    await prisma.featureFlag.update({
      where: { key: "FF_DIRECTORY" },
      data: { enabledForTenants: { push: optedOut.id } },
    });

    await runSeed();

    expect(await enabledTenants("FF_NOTIFICATIONS")).toEqual([demo.id]);
  });
});
