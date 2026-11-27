import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus, seedNewTenantFlags } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as tenantLayoutLoader } from "~/routes/$tenant/_layout";
import { loader as directoryLayoutLoader } from "~/routes/$tenant/_directory/_layout";
import { action as newTenantAction, loader as newTenantLoader } from "~/routes/$tenant/tenants/new";
import { loader as searchPageLoader } from "~/routes/_public/index";
import { clearPublicTenantIdsCache } from "~/services/public-directory.server";
import { csrf } from "~/utils/auth/csrf.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

// The user picked on the tenant creation form becomes a member of the new
// tenant with the role the admin chose, and can open its workspace.

beforeEach(() => {
  clearFlagCache();
  clearPublicTenantIdsCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const userRole = await prisma.role.create({ data: { name: "user", scope: "GLOBAL" } });

  const submit = await prisma.permission.create({
    data: { resource: "directory-change", action: "submit", module: "directory" },
  });
  const readAll = await prisma.permission.create({
    data: { resource: "directory-change", action: "read-all", module: "directory" },
  });
  await prisma.rolePermission.createMany({
    data: [
      { roleId: focalRole.id, permissionId: submit.id, access: "any" },
      { roleId: managerRole.id, permissionId: submit.id, access: "any" },
      { roleId: managerRole.id, permissionId: readAll.id, access: "any" },
    ],
  });
  await seedNewTenantFlags(prisma);

  const admin = await prisma.user.create({
    data: {
      ...buildUser({ tenantId: system.id, userStatusId: status.id }),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  // A registered account that belongs to no tenant yet: a plain directory reader.
  const addReader = (tenantId: string | null = null) =>
    prisma.user.create({
      data: {
        ...buildUser({ tenantId, userStatusId: status.id }),
        userRoles: { create: { roleId: userRole.id } },
      },
    });

  return { system, adminCookie: await createSessionCookie(prisma, admin.id), addReader };
}

function get(cookie: string, path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { cookie } });
}

type Outcome = { status: number; location: string | null; errors: Record<string, string[]> };

async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  const result = await run().catch((thrown) => thrown);
  if (result instanceof Response) {
    return { status: result.status, location: result.headers.get("location"), errors: {} };
  }
  if (result instanceof Error) throw result;
  const { data, init } = result as {
    data?: { error?: Record<string, string[]> | null };
    init?: { status?: number } | null;
  };
  return { status: init?.status ?? 200, location: null, errors: data?.error ?? {} };
}

/** Submit the tenant creation form as the global admin. */
async function createTenantInUi(adminCookie: string, extra: Record<string, string>) {
  const [token, csrfCookie] = await csrf.commitToken();
  const request = new Request("http://localhost/system/tenants/new", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${adminCookie}; ${csrfCookie!.split(";")[0]}`,
    },
    body: new URLSearchParams({
      name: "Medical Services",
      slug: "medical",
      email: "medical@example.org",
      phone: "+251 11 000 0000",
      ...extra,
      csrf: token,
    }).toString(),
  });
  return outcomeOf(() =>
    newTenantAction({ request, params: { tenant: "system" }, context: {} } as never),
  );
}

/** Where the signed-in user ends up when they open the site. */
async function landingOf(cookie: string) {
  return outcomeOf(() =>
    searchPageLoader({ request: get(cookie, "/"), params: {}, context: {} } as never),
  );
}

async function openWorkspace(cookie: string, slug: string) {
  return outcomeOf(() =>
    tenantLayoutLoader({
      request: get(cookie, `/${slug}`),
      params: { tenant: slug },
      context: {},
    } as never),
  );
}

async function directoryAccess(cookie: string, slug: string) {
  return (await directoryLayoutLoader({
    request: get(cookie, `/${slug}`),
    params: { tenant: slug },
    context: {},
  } as never)) as { canReview: boolean; canSubmit: boolean };
}

async function roleNamesOf(userId: string) {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { name: true } } },
  });
  return rows.map((r) => r.role.name).sort();
}

describe("initial user of a new tenant", () => {
  it("moves the picked user into the tenant as a focal person", async () => {
    const a = await arrange();
    const picked = await a.addReader();
    const cookie = await createSessionCookie(prisma, picked.id);
    expect((await landingOf(cookie)).location).toBeNull();

    const created = await createTenantInUi(a.adminCookie, {
      initialUserId: picked.id,
      initialUserRole: "focal",
    });
    expect(created.status).toBe(302);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "medical" } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: picked.id } });
    expect(after.tenantId).toBe(tenant.id);
    expect(await roleNamesOf(picked.id)).toEqual(["focal", "user"]);

    expect((await landingOf(cookie)).location).toBe("/medical");
    expect((await openWorkspace(cookie, "medical")).status).toBe(200);
    expect(await directoryAccess(cookie, "medical")).toEqual({
      canReview: false,
      canSubmit: true,
    });
  });

  it("moves the picked user into the tenant as a manager", async () => {
    const a = await arrange();
    const picked = await a.addReader();
    const cookie = await createSessionCookie(prisma, picked.id);

    const created = await createTenantInUi(a.adminCookie, {
      initialUserId: picked.id,
      initialUserRole: "manager",
    });
    expect(created.status).toBe(302);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "medical" } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: picked.id } });
    expect(after.tenantId).toBe(tenant.id);
    expect(await roleNamesOf(picked.id)).toEqual(["manager", "user"]);

    expect((await landingOf(cookie)).location).toBe("/medical");
    expect((await openWorkspace(cookie, "medical")).status).toBe(200);
    expect((await directoryAccess(cookie, "medical")).canReview).toBe(true);
  });

  it("creates the tenant with no members when no user is picked", async () => {
    const a = await arrange();
    const bystander = await a.addReader();

    const created = await createTenantInUi(a.adminCookie, { initialUserId: "" });
    expect(created.status).toBe(302);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "medical" } });
    expect(await prisma.user.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await roleNamesOf(bystander.id)).toEqual(["user"]);
  });

  it("asks for a role when a user is picked without one", async () => {
    const a = await arrange();
    const picked = await a.addReader();

    const created = await createTenantInUi(a.adminCookie, { initialUserId: picked.id });

    expect(created.status).toBe(400);
    expect(created.errors.initialUserRole).toHaveLength(1);
    expect(await prisma.tenant.findUnique({ where: { slug: "medical" } })).toBeNull();
  });

  it("refuses a user who already belongs to a tenant, and creates nothing", async () => {
    const a = await arrange();
    const other = await prisma.tenant.create({ data: buildTenant() });
    const member = await a.addReader(other.id);

    const created = await createTenantInUi(a.adminCookie, {
      initialUserId: member.id,
      initialUserRole: "manager",
    });

    expect(created.status).toBe(400);
    expect(created.errors.initialUserId).toHaveLength(1);
    expect(await prisma.tenant.findUnique({ where: { slug: "medical" } })).toBeNull();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.tenantId).toBe(other.id);
    expect(await roleNamesOf(member.id)).toEqual(["user"]);
  });

  it("offers only users who belong to no tenant", async () => {
    const a = await arrange();
    const free = await a.addReader();
    await a.addReader(a.system.id);

    const result = (await newTenantLoader({
      request: get(a.adminCookie, "/system/tenants/new"),
      params: { tenant: "system" },
      context: {},
    } as never)) as { data: { eligibleUsers: { id: string }[] } };

    expect(result.data.eligibleUsers.map((u) => u.id)).toEqual([free.id]);
  });
});
