import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { createRole, deleteRole, RoleGuardError, updateRole } from "~/services/roles.server";
import { LastAdminError, replaceUserRoles, softDeleteUser } from "~/services/users.server";

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const makeUser = (roleId: string) =>
    prisma.user.create({
      data: {
        ...buildUser({ tenantId: tenant.id, userStatusId: status.id }),
        userRoles: { create: { roleId } },
      },
    });
  const admin = await makeUser(adminRole.id);
  const ctx = { tenantId: tenant.id, userId: admin.id };
  return { tenant, adminRole, focalRole, admin, makeUser, ctx };
}

describe("built-in roles", () => {
  it("cannot be renamed, re-scoped or deleted", async () => {
    const { adminRole, focalRole, ctx } = await arrange();

    await expect(updateRole(adminRole.id, { name: "boss", scope: "GLOBAL" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );
    await expect(updateRole(adminRole.id, { name: "admin", scope: "TENANT" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );
    await expect(updateRole(focalRole.id, { name: "focal", scope: "GLOBAL" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );
    await expect(deleteRole(focalRole.id, ctx)).rejects.toThrow(RoleGuardError);

    const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
    expect(roles.map((r) => `${r.name}:${r.scope}`)).toEqual(["admin:GLOBAL", "focal:TENANT"]);
  });

  it("can still have their description edited", async () => {
    const { adminRole, ctx } = await arrange();
    await updateRole(adminRole.id, { name: "admin", scope: "GLOBAL", description: "Runs it" }, ctx);
    const role = await prisma.role.findUniqueOrThrow({ where: { id: adminRole.id } });
    expect(role.description).toBe("Runs it");
  });

  it("cannot be shadowed by a second role with the same name", async () => {
    const { ctx } = await arrange();
    await expect(createRole({ name: "admin", scope: "GLOBAL" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );
    await expect(createRole({ name: "Admin", scope: "TENANT" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );
    expect(
      await prisma.role.count({ where: { name: { equals: "admin", mode: "insensitive" } } }),
    ).toBe(1);
  });
});

describe("global role names", () => {
  it("are unique, whether the clash comes from creating or editing", async () => {
    const { ctx } = await arrange();
    await createRole({ name: "auditor", scope: "GLOBAL" }, ctx);
    await expect(createRole({ name: "Auditor", scope: "GLOBAL" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );

    const local = await createRole({ name: "auditor", scope: "TENANT" }, ctx);
    await expect(updateRole(local.id, { name: "auditor", scope: "GLOBAL" }, ctx)).rejects.toThrow(
      RoleGuardError,
    );
    expect(await prisma.role.count({ where: { name: "auditor", tenantId: null } })).toBe(1);
  });
});

describe("the last platform admin", () => {
  it("cannot be deleted or stripped of the admin role", async () => {
    const { admin, focalRole, ctx } = await arrange();

    await expect(softDeleteUser(admin.id, ctx)).rejects.toThrow(LastAdminError);
    await expect(replaceUserRoles(admin.id, [], ctx)).rejects.toThrow(LastAdminError);
    await expect(replaceUserRoles(admin.id, [focalRole.id], ctx)).rejects.toThrow(LastAdminError);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      include: { userRoles: { include: { role: true } } },
    });
    expect(after.deletedAt).toBeNull();
    expect(after.userRoles.map((ur) => ur.role.name)).toEqual(["admin"]);
  });

  it("can be removed once a second admin exists, and a deleted admin does not count", async () => {
    const { admin, adminRole, focalRole, makeUser, ctx } = await arrange();
    const second = await makeUser(adminRole.id);

    await softDeleteUser(second.id, ctx);
    await expect(softDeleteUser(admin.id, ctx)).rejects.toThrow(LastAdminError);

    const third = await makeUser(adminRole.id);
    await replaceUserRoles(admin.id, [focalRole.id], ctx);
    await expect(softDeleteUser(third.id, ctx)).rejects.toThrow(LastAdminError);
  });

  it("does not get in the way of ordinary users", async () => {
    const { focalRole, makeUser, ctx } = await arrange();
    const focal = await makeUser(focalRole.id);
    await replaceUserRoles(focal.id, [], ctx);
    await softDeleteUser(focal.id, ctx);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: focal.id } });
    expect(after.deletedAt).not.toBeNull();
  });
});
