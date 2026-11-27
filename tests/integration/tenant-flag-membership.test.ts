import { describe, expect, it } from "vitest";
import { prisma } from "../setup/integration-setup";

import {
  addTenantToFlag,
  removeTenantFromFlag,
} from "~/utils/config/tenant-flag-membership.server";

async function flagWith(enabledForTenants: string[]) {
  await prisma.featureFlag.create({
    data: { key: "FF_DIRECTORY", scope: "tenant", enabled: true, enabledForTenants },
  });
}

async function enabledTenants() {
  const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key: "FF_DIRECTORY" } });
  return flag.enabledForTenants;
}

describe("tenant flag membership", () => {
  it("adds a tenant to the enabled list and keeps the tenants already on it", async () => {
    await flagWith(["tenant-a", "tenant-b"]);

    await addTenantToFlag(prisma, "FF_DIRECTORY", "tenant-c");

    expect(await enabledTenants()).toEqual(["tenant-a", "tenant-b", "tenant-c"]);
  });

  it("does not list a tenant twice", async () => {
    await flagWith(["tenant-a"]);

    await addTenantToFlag(prisma, "FF_DIRECTORY", "tenant-a");
    await addTenantToFlag(prisma, "FF_DIRECTORY", "tenant-a");

    expect(await enabledTenants()).toEqual(["tenant-a"]);
  });

  it("removes one tenant and keeps the others", async () => {
    await flagWith(["tenant-a", "tenant-b", "tenant-c"]);

    await removeTenantFromFlag(prisma, "FF_DIRECTORY", "tenant-b");
    await removeTenantFromFlag(prisma, "FF_DIRECTORY", "tenant-never-added");

    expect(await enabledTenants()).toEqual(["tenant-a", "tenant-c"]);
  });

  it("keeps both tenants when two are added at the same time", async () => {
    await flagWith([]);

    await Promise.all([
      addTenantToFlag(prisma, "FF_DIRECTORY", "tenant-a"),
      addTenantToFlag(prisma, "FF_DIRECTORY", "tenant-b"),
    ]);

    expect([...(await enabledTenants())].sort()).toEqual(["tenant-a", "tenant-b"]);
  });

  it("refuses a flag that does not exist", async () => {
    await expect(addTenantToFlag(prisma, "FF_NO_SUCH_FLAG", "tenant-a")).rejects.toThrow(
      /FF_NO_SUCH_FLAG/,
    );
    await expect(removeTenantFromFlag(prisma, "FF_NO_SUCH_FLAG", "tenant-a")).rejects.toThrow(
      /FF_NO_SUCH_FLAG/,
    );
  });
});
