import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as newRoleAction } from "~/routes/$tenant/settings/security/roles/new";
import { loader as userRolesLoader } from "~/routes/$tenant/settings/security/users/$userId/roles";
import { loader as newUserLoader } from "~/routes/$tenant/settings/security/users/new";
import { csrf } from "~/utils/auth/csrf.server";
import { createSessionCookie } from "./helpers/session";

// Roles are platform-wide definitions: the canonical `manager` and `focal`
// rows belong to no tenant. These tests pin down that a role an admin creates
// is stored the same way, so it is offered in every tenant.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const [adminHome, elsewhere] = await Promise.all([
    prisma.tenant.create({ data: buildTenant() }),
    prisma.tenant.create({ data: buildTenant() }),
  ]);

  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });

  for (const action of ["read", "create", "update"]) {
    const perm = await prisma.permission.create({
      data: { resource: "user", action, module: "security" },
    });
    await prisma.rolePermission.createMany({
      data: [managerRole.id, adminRole.id].map((roleId) => ({
        roleId,
        permissionId: perm.id,
        access: "any",
      })),
    });
  }

  const mkUser = (tenantId: string, roleId: string) =>
    prisma.user.create({
      data: {
        ...buildUser(),
        tenantId,
        userStatusId: status.id,
        userRoles: { create: { roleId } },
      },
    });

  const admin = await mkUser(adminHome.id, adminRole.id);
  const manager = await mkUser(elsewhere.id, managerRole.id);
  const colleague = await mkUser(elsewhere.id, focalRole.id);

  return {
    adminHome,
    elsewhere,
    colleague,
    roles: { admin: adminRole, manager: managerRole, focal: focalRole },
    adminCookie: await createSessionCookie(prisma, admin.id),
    managerCookie: await createSessionCookie(prisma, manager.id),
  };
}

function get(cookie: string, tenant = "t"): Request {
  return new Request(`http://localhost/${tenant}/settings/security/x`, { headers: { cookie } });
}

async function post(cookie: string, fields: [string, string][]) {
  const form = new URLSearchParams();
  let cookieHeader = cookie;
  const [token, csrfCookie] = await csrf.commitToken();
  form.set("csrf", token);
  if (csrfCookie) cookieHeader = `${cookie}; ${csrfCookie.split(";")[0]}`;
  for (const [k, v] of fields) form.append(k, v);
  return new Request("http://localhost/t/settings/security/x", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
    body: form.toString(),
  });
}

const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params: { tenant: "t", ...params }, context: {} }) as never;

async function createRoleAs(cookie: string, name: string, scope: string) {
  return (await newRoleAction(
    args(
      await post(cookie, [
        ["name", name],
        ["scope", scope],
      ]),
    ),
  )) as unknown as Response | { init: { status: number } | null };
}

const names = (roles: { name: string }[]) => roles.map((r) => r.name).sort();

describe("a tenant-scope role created by an admin", () => {
  it("is stored like the canonical manager and focal roles", async () => {
    const a = await arrange();

    const response = await createRoleAs(a.adminCookie, "editor", "TENANT");
    expect((response as Response).status).toBe(302);

    const tenantRoles = await prisma.role.findMany({
      where: { scope: "TENANT" },
      select: { name: true, tenantId: true },
      orderBy: { name: "asc" },
    });
    expect(tenantRoles).toEqual([
      { name: "editor", tenantId: null },
      { name: "focal", tenantId: null },
      { name: "manager", tenantId: null },
    ]);
  });

  it("appears in the role pickers of a tenant other than the admin's own", async () => {
    const a = await arrange();
    await createRoleAs(a.adminCookie, "editor", "TENANT");

    const newUser = await newUserLoader(
      args(get(a.managerCookie, a.elsewhere.slug), { tenant: a.elsewhere.slug }),
    );
    expect(names(newUser.data.roles)).toEqual(["editor", "focal", "manager"]);

    const userRoles = await userRolesLoader(args(get(a.managerCookie), { userId: a.colleague.id }));
    expect(names(userRoles.data.allRoles)).toEqual(["editor", "focal", "manager"]);
  });

  it("cannot share a name with another role, whatever the scope", async () => {
    const a = await arrange();
    await createRoleAs(a.adminCookie, "editor", "TENANT");

    const again = await createRoleAs(a.adminCookie, "Editor", "TENANT");
    expect((again as { init: { status: number } }).init.status).toBe(400);
    const asGlobal = await createRoleAs(a.adminCookie, "editor", "GLOBAL");
    expect((asGlobal as { init: { status: number } }).init.status).toBe(400);

    expect(
      await prisma.role.count({ where: { name: { equals: "editor", mode: "insensitive" } } }),
    ).toBe(1);
  });
});
