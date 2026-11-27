import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as editAction } from "~/routes/$tenant/settings/security/users/$userId/edit";
import { csrf } from "~/utils/auth/csrf.server";
import { createSessionCookie } from "./helpers/session";

// Ticket #17, suspicion 1: a global admin's edit of a user that does not
// carry a tenant field must leave the user's tenant and roles alone. Only an
// explicit choice in the tenant picker moves the user.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const [home, other] = await Promise.all([
    prisma.tenant.create({ data: buildTenant() }),
    prisma.tenant.create({ data: buildTenant() }),
  ]);

  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const perm = await prisma.permission.create({
    data: { resource: "user", action: "update", module: "security" },
  });
  await prisma.rolePermission.create({
    data: { roleId: adminRole.id, permissionId: perm.id, access: "any" },
  });

  const mkUser = (tenantId: string, roleId: string) =>
    prisma.user.create({
      data: {
        ...buildUser(),
        tenantId,
        userStatusId: status.id,
        userRoles: { create: { roleId } },
      },
    });

  const admin = await mkUser(home.id, adminRole.id);
  const focal = await mkUser(other.id, focalRole.id);

  return {
    home,
    other,
    focal,
    focalRole,
    adminCookie: await createSessionCookie(prisma, admin.id),
  };
}

async function post(cookie: string, fields: [string, string][]) {
  const form = new URLSearchParams();
  let cookieHeader = cookie;
  const [token, csrfCookie] = await csrf.commitToken();
  form.set("csrf", token);
  if (csrfCookie) cookieHeader = `${cookie}; ${csrfCookie.split(";")[0]}`;
  for (const [k, v] of fields) form.append(k, v);
  return new Request("http://localhost/t/settings/security/users/x/edit", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
    body: form.toString(),
  });
}

async function edit(cookie: string, userId: string, fields: [string, string][]) {
  const request = await post(cookie, fields);
  const response = await editAction({
    request,
    params: { tenant: "t", userId },
    context: {},
  } as never).catch((err: unknown) => err);
  expect((response as Response).status).toBe(302);
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { userRoles: true },
  });
}

describe("global admin edits a user", () => {
  it("leaves tenant and roles unchanged when the form sends no tenant", async () => {
    const a = await arrange();
    const after = await edit(a.adminCookie, a.focal.id, [
      ["firstName", "Renamed"],
      ["lastName", a.focal.lastName],
      ["email", a.focal.email],
    ]);

    expect(after.firstName).toBe("Renamed");
    expect(after.tenantId).toBe(a.other.id);
    expect(after.userRoles.map((ur) => ur.roleId)).toEqual([a.focalRole.id]);
  });

  it("leaves tenant and roles unchanged when the form sends the current tenant", async () => {
    const a = await arrange();
    const after = await edit(a.adminCookie, a.focal.id, [
      ["firstName", "Renamed"],
      ["lastName", a.focal.lastName],
      ["email", a.focal.email],
      ["tenantId", a.other.id],
    ]);

    expect(after.tenantId).toBe(a.other.id);
    expect(after.userRoles.map((ur) => ur.roleId)).toEqual([a.focalRole.id]);
  });

  it("still clears the tenant when the picker is explicitly set to none", async () => {
    const a = await arrange();
    const after = await edit(a.adminCookie, a.focal.id, [
      ["firstName", a.focal.firstName],
      ["lastName", a.focal.lastName],
      ["email", a.focal.email],
      ["tenantId", ""],
    ]);

    expect(after.tenantId).toBeNull();
    expect(after.userRoles).toHaveLength(0);
  });

  it("still moves the user when another tenant is chosen", async () => {
    const a = await arrange();
    const after = await edit(a.adminCookie, a.focal.id, [
      ["firstName", a.focal.firstName],
      ["lastName", a.focal.lastName],
      ["email", a.focal.email],
      ["tenantId", a.home.id],
    ]);

    expect(after.tenantId).toBe(a.home.id);
    expect(after.userRoles).toHaveLength(0);
  });
});
