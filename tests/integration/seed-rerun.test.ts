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
    languages: await prisma.language.findMany(byId),
  };
}

async function enabledTenants(key: string) {
  const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key } });
  return [...flag.enabledForTenants].sort();
}

describe("running the seed", () => {
  it("gives a fresh database the starter directory in the system tenant", async () => {
    await runSeed();

    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([system.id]);
    }
    const orgs = await prisma.organization.findMany({ where: { tenantId: system.id } });
    expect(orgs.map((o) => o.acronym).sort()).toEqual(["AU", "AUC", "ETTIM", "ODC", "OOC", "PAPS"]);
    expect(await prisma.memberState.count()).toBe(55);
    expect(await prisma.person.count({ where: { tenantId: system.id } })).toBeGreaterThan(0);
    expect(
      await prisma.positionAssignment.count({ where: { tenantId: system.id, isCurrent: true } }),
    ).toBeGreaterThan(0);
  });

  it("leaves existing directory records untouched when run again", async () => {
    await runSeed();
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
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
      data: { tenantId: system.id, name: "Added by hand", typeId: paps.typeId, parentId: au.id },
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
      data: { tenantId: system.id, firstName: "Added", lastName: "Byhand", languages: [] },
    });
    await prisma.changeRequest.create({
      data: {
        tenantId: system.id,
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
    const system = await prisma.tenant.findFirstOrThrow({ where: { slug: "system" } });
    const optedIn = await prisma.tenant.create({ data: buildTenant() });
    for (const key of [...DIRECTORY_FLAGS, "FF_NOTIFICATIONS"]) {
      await prisma.featureFlag.update({
        where: { key },
        data: { enabledForTenants: { push: optedIn.id } },
      });
    }

    await runSeed();

    for (const key of DIRECTORY_FLAGS) {
      expect(await enabledTenants(key)).toEqual([optedIn.id, system.id].sort());
    }
    expect(await enabledTenants("FF_NOTIFICATIONS")).toEqual([optedIn.id]);
  });
});
