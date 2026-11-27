import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { deleteTenant, TenantDeleteError } from "~/services/tenants.server";

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const admin = await prisma.user.create({
    data: buildUser({ tenantId: system.id, userStatusId: status.id }),
  });
  return { status, system, ctx: { tenantId: system.id, userId: admin.id } };
}

describe("deleting a tenant", () => {
  it("refuses the system tenant, even with no users in it", async () => {
    const { system, ctx } = await arrange();
    await prisma.user.updateMany({ data: { deletedAt: new Date() } });

    await expect(deleteTenant(system.id, ctx)).rejects.toThrow(TenantDeleteError);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: system.id } })).deletedAt,
    ).toBeNull();
  });

  it("refuses a tenant that still has users", async () => {
    const { status, ctx } = await arrange();
    const tenant = await prisma.tenant.create({ data: buildTenant() });
    await prisma.user.create({ data: buildUser({ tenantId: tenant.id, userStatusId: status.id }) });

    await expect(deleteTenant(tenant.id, ctx)).rejects.toThrow(TenantDeleteError);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).deletedAt,
    ).toBeNull();
  });

  it("deletes an empty tenant", async () => {
    const { ctx } = await arrange();
    const tenant = await prisma.tenant.create({ data: buildTenant() });

    await deleteTenant(tenant.id, ctx);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).deletedAt,
    ).not.toBeNull();
  });
});
