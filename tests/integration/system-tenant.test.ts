import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus, seedNewTenantFlags } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as tenantLayoutLoader } from "~/routes/$tenant/_layout";
import { loader as directoryLayoutLoader } from "~/routes/$tenant/_directory/_layout";
import { action as editUserAction } from "~/routes/$tenant/settings/security/users/$userId/edit";
import { action as userRolesAction } from "~/routes/$tenant/settings/security/users/$userId/roles";
import { action as newUserAction } from "~/routes/$tenant/settings/security/users/new";
import { action as tenantFeaturesAction } from "~/routes/$tenant/tenants/$tenantId/features";
import { clearPublicTenantIdsCache, getPublicTenantIds } from "~/services/public-directory.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { get, post } from "./helpers/requests";
import { createSessionCookie } from "./helpers/session";

// Ticket #24: the system tenant is the global admin's home and nothing else.
// It has no directory, takes no part in cross-tenant search, and nobody can
// be made a focal person or manager in it.

beforeEach(() => {
  clearFlagCache();
  clearPublicTenantIdsCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const working = await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });

  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const readerRole = await prisma.role.create({ data: { name: "user", scope: "GLOBAL" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  for (const [resource, action] of [
    ["user", "create"],
    ["user", "update"],
    ["organization", "read"],
  ]) {
    const permission = await prisma.permission.create({
      data: { resource, action, module: "system" },
    });
    await prisma.rolePermission.create({
      data: { roleId: adminRole.id, permissionId: permission.id, access: "any" },
    });
  }

  // Only the working tenant is opted into the directory, as after a seed.
  await seedNewTenantFlags(prisma, [working.id]);

  const mkUser = (tenantId: string | null, roleId: string) =>
    prisma.user.create({
      data: {
        ...buildUser({ tenantId, userStatusId: status.id }),
        userRoles: { create: { roleId } },
      },
    });
  const admin = await mkUser(system.id, adminRole.id);

  return {
    status,
    system,
    working,
    focalRole,
    managerRole,
    readerRole,
    mkUser,
    adminCookie: await createSessionCookie(prisma, admin.id),
  };
}

type Outcome = { status: number; body: string };

/** Run a loader/action; report its HTTP status and what it sent back. */
async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  const result = await run().catch((thrown) => thrown);
  if (result instanceof Response) return { status: result.status, body: await result.text() };
  const { init, data } = result as { init?: { status?: number } | null; data?: unknown };
  return { status: init?.status ?? 200, body: JSON.stringify(data) };
}

const args = (request: Request, params: Record<string, string>) =>
  ({ request, params: { tenant: "system", ...params }, context: {} }) as never;

async function createUser(cookie: string, fields: [string, string][]) {
  const request = await post("/system/settings/security/users/new", cookie, [
    ["firstName", "New"],
    ["lastName", "Person"],
    ["password", "Sup3rSecret!pw"],
    ...fields,
  ]);
  return outcome(() => newUserAction(args(request, {})));
}

async function assignRoles(cookie: string, userId: string, roleIds: string[]) {
  const request = await post(
    `/system/settings/security/users/${userId}/roles`,
    cookie,
    roleIds.map((id) => ["roleIds", id]),
  );
  return outcome(() => userRolesAction(args(request, { userId })));
}

async function moveUser(
  cookie: string,
  user: { id: string; firstName: string; lastName: string; email: string },
  tenantId: string,
) {
  const request = await post(`/system/settings/security/users/${user.id}/edit`, cookie, [
    ["firstName", user.firstName],
    ["lastName", user.lastName],
    ["email", user.email],
    ["tenantId", tenantId],
  ]);
  return outcome(() => editUserAction(args(request, { userId: user.id })));
}

async function roleNamesOf(userId: string) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { name: true } } },
  });
  return roles.map((r) => r.role.name).sort();
}

describe("focal persons and managers stay out of the system tenant", () => {
  it("refuses to create a focal person in the system tenant", async () => {
    const a = await arrange();

    const result = await createUser(a.adminCookie, [
      ["email", "focal@example.org"],
      ["tenantId", a.system.id],
      ["roleIds", a.focalRole.id],
    ]);

    expect(result.status).toBe(400);
    expect(result.body).toContain("system tenant");
    expect(await prisma.user.count({ where: { email: "focal@example.org" } })).toBe(0);
  });

  it("still creates a focal person in a working tenant and a reader in the system tenant", async () => {
    const a = await arrange();

    const focal = await createUser(a.adminCookie, [
      ["email", "focal@example.org"],
      ["tenantId", a.working.id],
      ["roleIds", a.focalRole.id],
    ]);
    const reader = await createUser(a.adminCookie, [
      ["email", "reader@example.org"],
      ["tenantId", a.system.id],
      ["roleIds", a.readerRole.id],
    ]);

    expect(focal.status).toBe(302);
    expect(reader.status).toBe(302);
    const created = await prisma.user.findUniqueOrThrow({ where: { email: "focal@example.org" } });
    expect(created.tenantId).toBe(a.working.id);
    expect(await roleNamesOf(created.id)).toEqual(["focal"]);
  });

  it("refuses to make a user of the system tenant a manager", async () => {
    const a = await arrange();
    const reader = await a.mkUser(a.system.id, a.readerRole.id);

    const result = await assignRoles(a.adminCookie, reader.id, [a.readerRole.id, a.managerRole.id]);

    expect(result.status).toBe(400);
    expect(result.body).toContain("system tenant");
    expect(await roleNamesOf(reader.id)).toEqual(["user"]);
  });

  it("refuses to move a manager into the system tenant", async () => {
    const a = await arrange();
    const manager = await a.mkUser(a.working.id, a.managerRole.id);

    const result = await moveUser(a.adminCookie, manager, a.system.id);

    expect(result.status).toBe(400);
    expect(result.body).toContain("system tenant");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: manager.id } });
    expect(after.tenantId).toBe(a.working.id);
    expect(await roleNamesOf(manager.id)).toEqual(["manager"]);
  });

  it("still moves a plain reader into the system tenant", async () => {
    const a = await arrange();
    const reader = await a.mkUser(a.working.id, a.readerRole.id);

    const result = await moveUser(a.adminCookie, reader, a.system.id);

    expect(result.status).toBe(302);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: reader.id } });
    expect(after.tenantId).toBe(a.system.id);
  });
});

describe("the system tenant has no directory", () => {
  async function setFlag(cookie: string, tenantId: string, flagKey: string, enabled: boolean) {
    const request = await post(`/system/tenants/${tenantId}/features`, cookie, [
      ["flagKey", flagKey],
      ["enabled", String(enabled)],
    ]);
    return outcome(() => tenantFeaturesAction(args(request, { tenantId })));
  }

  async function navFeatures(cookie: string, slug: string) {
    const result = (await tenantLayoutLoader({
      request: get(`/${slug}`, cookie),
      params: { tenant: slug },
      context: {},
    } as never)) as unknown as { data: { enabledFeatures: Record<string, boolean> } };
    return result.data.enabledFeatures;
  }

  function openDirectory(cookie: string, slug: string) {
    return outcome(() =>
      directoryLayoutLoader({
        request: get(`/${slug}`, cookie),
        params: { tenant: slug },
        context: {},
      } as never),
    );
  }

  it.each(["FF_DIRECTORY", "FF_PUBLIC_DIRECTORY"])(
    "refuses to opt the system tenant into %s",
    async (flagKey) => {
      const a = await arrange();

      const result = await setFlag(a.adminCookie, a.system.id, flagKey, true);

      expect(result.status).toBe(400);
      const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key: flagKey } });
      expect(flag.enabledForTenants).toEqual([a.working.id]);
      expect(await getPublicTenantIds()).toEqual([a.working.id]);
    },
  );

  it("shows the global admin no Directory section in the system tenant", async () => {
    const a = await arrange();

    expect((await navFeatures(a.adminCookie, "system")).FF_DIRECTORY).toBe(false);
    expect((await openDirectory(a.adminCookie, "system")).status).toBe(404);
  });

  it("shows the global admin the Organogram and Positions pages in the system tenant", async () => {
    const a = await arrange();

    expect((await navFeatures(a.adminCookie, "system")).DIRECTORY_STRUCTURE).toBe(true);
    expect((await navFeatures(a.adminCookie, "medical")).DIRECTORY_STRUCTURE).toBe(true);
  });

  it("shows the global admin the Directory section of a working tenant", async () => {
    const a = await arrange();

    expect((await navFeatures(a.adminCookie, "medical")).FF_DIRECTORY).toBe(true);
    expect((await openDirectory(a.adminCookie, "medical")).status).toBe(200);
  });

  it("follows the tenant in the URL, not the admin's home, when a tenant is opted out", async () => {
    const a = await arrange();
    expect((await setFlag(a.adminCookie, a.working.id, "FF_DIRECTORY", false)).status).toBe(200);

    expect((await navFeatures(a.adminCookie, "medical")).FF_DIRECTORY).toBe(false);
    expect((await openDirectory(a.adminCookie, "medical")).status).toBe(404);
  });
});
