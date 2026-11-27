import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as deleteAction } from "~/routes/$tenant/settings/security/users/$userId/delete";
import { action as editAction } from "~/routes/$tenant/settings/security/users/$userId/edit";
import { loader as detailLoader } from "~/routes/$tenant/settings/security/users/$userId/index";
import { action as rolesAction } from "~/routes/$tenant/settings/security/users/$userId/roles";
import { loader as roleDetailLoader } from "~/routes/$tenant/settings/security/roles/$roleId/index";
import { csrf } from "~/utils/auth/csrf.server";
import { createSessionCookie } from "./helpers/session";

// A manager holds `user:*`, which says what they may do. These tests pin down
// to whom: only users in the manager's own tenant, and never a holder of a
// GLOBAL-scope role.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const [home, other] = await Promise.all([
    // The requests below are made under `/t/...`, the manager's own tenant.
    prisma.tenant.create({ data: buildTenant({ slug: "t" }) }),
    prisma.tenant.create({ data: buildTenant() }),
  ]);

  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });

  for (const [resource, action] of [
    ["user", "read"],
    ["user", "create"],
    ["user", "update"],
    ["user", "delete"],
    ["role", "read"],
  ]) {
    const perm = await prisma.permission.create({ data: { resource, action, module: "security" } });
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

  const manager = await mkUser(home.id, managerRole.id);
  const colleague = await mkUser(home.id, focalRole.id);
  const outsider = await mkUser(other.id, focalRole.id);
  // The platform admin shares the manager's home tenant — the worst case.
  const admin = await mkUser(home.id, adminRole.id);

  return {
    home,
    manager,
    colleague,
    outsider,
    admin,
    roles: { admin: adminRole, manager: managerRole, focal: focalRole },
    managerCookie: await createSessionCookie(prisma, manager.id),
    adminCookie: await createSessionCookie(prisma, admin.id),
  };
}

function get(cookie: string): Request {
  return new Request("http://localhost/t/settings/security/users/x", { headers: { cookie } });
}

// Every POST carries a valid CSRF token, so a 403 here is the scope check
// refusing — not the CSRF check masking a missing one.
async function post(cookie: string, fields: [string, string][]) {
  const form = new URLSearchParams();
  let cookieHeader = cookie;
  const [token, csrfCookie] = await csrf.commitToken();
  form.set("csrf", token);
  if (csrfCookie) cookieHeader = `${cookie}; ${csrfCookie.split(";")[0]}`;
  for (const [k, v] of fields) form.append(k, v);
  return new Request("http://localhost/t/settings/security/users/x", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
    body: form.toString(),
  });
}

/** Loaders/actions throw `data()` or a Response on refusal; read its status. */
async function statusOf(promise: Promise<unknown>): Promise<number> {
  const result = (await promise.catch((err) => err)) as {
    status?: number;
    init?: { status?: number } | null;
  };
  return result?.init?.status ?? result?.status ?? 200;
}

const args = (request: Request, params: Record<string, string>) =>
  ({ request, params: { tenant: "t", ...params }, context: {} }) as never;

describe("user management is scoped to the actor's tenant", () => {
  it("manager can view a colleague but not a user in another tenant", async () => {
    const a = await arrange();
    expect(
      await statusOf(detailLoader(args(get(a.managerCookie), { userId: a.colleague.id }))),
    ).toBe(200);
    expect(
      await statusOf(detailLoader(args(get(a.managerCookie), { userId: a.outsider.id }))),
    ).toBe(404);
  });

  it("manager cannot edit, re-role or delete a user in another tenant", async () => {
    const a = await arrange();
    const params = { userId: a.outsider.id };
    const edit = await post(a.managerCookie, [
      ["firstName", "X"],
      ["lastName", "Y"],
      ["email", "taken-over@test.com"],
    ]);
    expect(await statusOf(editAction(args(edit, params)))).toBe(404);
    expect(await statusOf(rolesAction(args(await post(a.managerCookie, []), params)))).toBe(404);
    expect(await statusOf(deleteAction(args(await post(a.managerCookie, []), params)))).toBe(404);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: a.outsider.id },
      include: { userRoles: true },
    });
    expect(after.email).toBe(a.outsider.email);
    expect(after.deletedAt).toBeNull();
    expect(after.userRoles).toHaveLength(1);
  });

  it("manager cannot modify a platform admin, even in their own tenant", async () => {
    const a = await arrange();
    const params = { userId: a.admin.id };
    const edit = await post(a.managerCookie, [
      ["firstName", "X"],
      ["lastName", "Y"],
      ["email", "taken-over@test.com"],
    ]);
    expect(await statusOf(editAction(args(edit, params)))).toBe(403);
    // An empty role list used to strip every role, GLOBAL admin included.
    expect(await statusOf(rolesAction(args(await post(a.managerCookie, []), params)))).toBe(403);
    expect(await statusOf(deleteAction(args(await post(a.managerCookie, []), params)))).toBe(403);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: a.admin.id },
      include: { userRoles: true },
    });
    expect(after.email).toBe(a.admin.email);
    expect(after.deletedAt).toBeNull();
    expect(after.userRoles.map((ur) => ur.roleId)).toEqual([a.roles.admin.id]);
  });

  it("manager cannot grant a GLOBAL role", async () => {
    const a = await arrange();
    const grant = await post(a.managerCookie, [["roleIds", a.roles.admin.id]]);
    expect(await statusOf(rolesAction(args(grant, { userId: a.colleague.id })))).toBe(403);
  });

  it("manager can still re-role a colleague in their own tenant", async () => {
    const a = await arrange();
    const request = await post(a.managerCookie, [["roleIds", a.roles.manager.id]]);
    const response = await rolesAction(args(request, { userId: a.colleague.id })).catch(
      (err: unknown) => err,
    );
    expect((response as Response).status).toBe(302);
    const roles = await prisma.userRole.findMany({ where: { userId: a.colleague.id } });
    expect(roles.map((r) => r.roleId)).toEqual([a.roles.manager.id]);
  });

  it("platform admin can manage a user in any tenant", async () => {
    const a = await arrange();
    expect(await statusOf(detailLoader(args(get(a.adminCookie), { userId: a.outsider.id })))).toBe(
      200,
    );
  });

  it("role detail lists only same-tenant holders for a manager", async () => {
    const a = await arrange();
    const asManager = (await roleDetailLoader(
      args(get(a.managerCookie), { roleId: a.roles.focal.id }),
    )) as { data: { role: { userRoles: { user: { id: string } }[] } } };
    expect(asManager.data.role.userRoles.map((ur) => ur.user.id)).toEqual([a.colleague.id]);

    const asAdmin = (await roleDetailLoader(
      args(get(a.adminCookie), { roleId: a.roles.focal.id }),
    )) as { data: { role: { userRoles: { user: { id: string } }[] } } };
    expect(asAdmin.data.role.userRoles).toHaveLength(2);
  });
});
