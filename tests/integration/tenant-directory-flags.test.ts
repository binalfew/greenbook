import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus, seedNewTenantFlags } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as tenantLayoutLoader } from "~/routes/$tenant/_layout";
import { loader as directoryLayoutLoader } from "~/routes/$tenant/directory/_layout";
import {
  action as tenantFeaturesAction,
  loader as tenantFeaturesLoader,
} from "~/routes/$tenant/tenants/$tenantId/features";
import { action as newTenantAction } from "~/routes/$tenant/tenants/new";
import { clearPublicTenantIdsCache, getPublicTenantIds } from "~/services/public-directory.server";
import { clearFlagCache, isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { get, post } from "./helpers/requests";
import { createSessionCookie } from "./helpers/session";

// A tenant created through the UI is opted into the directory and into
// cross-tenant search, and the global admin can change either afterwards.
// The flag caches are cleared only between tests (the database is wiped then);
// inside a test a change has to be visible to the next request on its own.

beforeEach(() => {
  clearFlagCache();
  clearPublicTenantIdsCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  await prisma.role.createMany({
    data: [
      { name: "focal", scope: "TENANT" },
      { name: "user", scope: "GLOBAL" },
    ],
  });
  const readOrgs = await prisma.permission.create({
    data: { resource: "organization", action: "read", module: "directory" },
  });
  await prisma.rolePermission.create({
    data: { roleId: managerRole.id, permissionId: readOrgs.id, access: "any" },
  });

  // A working tenant is already on both lists, as the seed leaves its demo
  // tenant. The system tenant, the admin's home, is on neither.
  const existing = await prisma.tenant.create({ data: buildTenant() });
  await seedNewTenantFlags(prisma, [existing.id]);
  await prisma.featureFlag.create({
    data: { key: "FF_PWA", scope: "global", enabled: true },
  });

  const admin = await prisma.user.create({
    data: {
      ...buildUser({ tenantId: system.id, userStatusId: status.id }),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });

  const addManager = async (tenantId: string) => {
    const manager = await prisma.user.create({
      data: {
        ...buildUser({ tenantId, userStatusId: status.id }),
        userRoles: { create: { roleId: managerRole.id } },
      },
    });
    return createSessionCookie(prisma, manager.id);
  };

  return { existing, adminCookie: await createSessionCookie(prisma, admin.id), addManager };
}

/** Run a loader/action and return its HTTP status, whether returned or thrown. */
async function statusOf(run: () => Promise<unknown>): Promise<number> {
  const result = await run().catch((thrown) => thrown);
  if (result instanceof Response) return result.status;
  const init = (result as { init?: { status?: number } | null }).init;
  return init?.status ?? 200;
}

/** Create a tenant through the form the global admin uses. */
async function createTenantInUi(adminCookie: string, slug: string) {
  const request = await post("/system/tenants/new", adminCookie, {
    name: "Medical Services",
    slug,
    email: "medical@example.org",
    phone: "+251 11 000 0000",
  });
  const status = await statusOf(() =>
    newTenantAction({ request, params: { tenant: "system" }, context: {} } as never),
  );
  expect(status).toBe(302);
  return prisma.tenant.findUniqueOrThrow({ where: { slug } });
}

async function setTenantFlag(cookie: string, tenantId: string, flagKey: string, enabled: boolean) {
  const request = await post(`/system/tenants/${tenantId}/features`, cookie, {
    flagKey,
    enabled: String(enabled),
  });
  return statusOf(() =>
    tenantFeaturesAction({
      request,
      params: { tenant: "system", tenantId },
      context: {},
    } as never),
  );
}

function openDirectory(cookie: string, slug: string) {
  return statusOf(() =>
    directoryLayoutLoader({
      request: get(`/${slug}/directory`, cookie),
      params: { tenant: slug },
      context: {},
    } as never),
  );
}

async function navFeatures(cookie: string, slug: string) {
  const result = (await tenantLayoutLoader({
    request: get(`/${slug}`, cookie),
    params: { tenant: slug },
    context: {},
  } as never)) as unknown as { data: { enabledFeatures: Record<string, boolean> } };
  return result.data.enabledFeatures;
}

describe("creating a tenant in the UI", () => {
  it("enables the directory for the new tenant", async () => {
    const a = await arrange();

    const tenant = await createTenantInUi(a.adminCookie, "medical");

    expect(await isFeatureEnabled("FF_DIRECTORY", { tenantId: tenant.id })).toBe(true);
  });

  it("opts the new tenant into cross-tenant search", async () => {
    const a = await arrange();

    const tenant = await createTenantInUi(a.adminCookie, "medical");

    expect(await isFeatureEnabled("FF_PUBLIC_DIRECTORY", { tenantId: tenant.id })).toBe(true);
    expect(await getPublicTenantIds()).toContain(tenant.id);
  });

  it("leaves the tenants already opted in where they were", async () => {
    const a = await arrange();
    // Warm the search gate so a stale answer would show up below.
    expect(await getPublicTenantIds()).toEqual([a.existing.id]);

    const tenant = await createTenantInUi(a.adminCookie, "medical");

    expect(await isFeatureEnabled("FF_DIRECTORY", { tenantId: a.existing.id })).toBe(true);
    expect((await getPublicTenantIds()).sort()).toEqual([a.existing.id, tenant.id].sort());
  });

  it("lets a manager of the new tenant see and open the Directory section", async () => {
    const a = await arrange();
    const tenant = await createTenantInUi(a.adminCookie, "medical");
    const managerCookie = await a.addManager(tenant.id);

    expect((await navFeatures(managerCookie, "medical")).FF_DIRECTORY).toBe(true);
    expect(await openDirectory(managerCookie, "medical")).toBe(200);
  });
});

describe("the global admin changes a tenant's features", () => {
  type FeaturesData = { data: { flags: { key: string; enabled: boolean }[] } };

  async function listedFlags(cookie: string, tenantId: string) {
    const result = (await tenantFeaturesLoader({
      request: get(`/system/tenants/${tenantId}/features`, cookie),
      params: { tenant: "system", tenantId },
      context: {},
    } as never)) as unknown as FeaturesData;
    return Object.fromEntries(result.data.flags.map((f) => [f.key, f.enabled]));
  }

  it("lists each tenant-scoped flag with whether the tenant is opted in", async () => {
    const a = await arrange();
    const tenant = await prisma.tenant.create({ data: buildTenant() });

    const fresh = await listedFlags(a.adminCookie, tenant.id);
    expect(fresh).toMatchObject({ FF_DIRECTORY: false, FF_PUBLIC_DIRECTORY: false });
    // A global flag has no per-tenant enabled list, so it is not offered.
    expect(fresh).not.toHaveProperty("FF_PWA");
    expect(await listedFlags(a.adminCookie, a.existing.id)).toMatchObject({
      FF_DIRECTORY: true,
      FF_PUBLIC_DIRECTORY: true,
    });
  });

  it("opts a tenant out of the directory and back in", async () => {
    const a = await arrange();
    const tenant = await createTenantInUi(a.adminCookie, "medical");
    const managerCookie = await a.addManager(tenant.id);
    expect(await openDirectory(managerCookie, "medical")).toBe(200);

    expect(await setTenantFlag(a.adminCookie, tenant.id, "FF_DIRECTORY", false)).toBe(200);

    expect(await openDirectory(managerCookie, "medical")).toBe(404);
    expect((await navFeatures(managerCookie, "medical")).FF_DIRECTORY).toBe(false);
    expect((await listedFlags(a.adminCookie, tenant.id)).FF_DIRECTORY).toBe(false);

    expect(await setTenantFlag(a.adminCookie, tenant.id, "FF_DIRECTORY", true)).toBe(200);

    expect(await openDirectory(managerCookie, "medical")).toBe(200);
  });

  it("opts a tenant out of cross-tenant search and back in", async () => {
    const a = await arrange();
    const tenant = await createTenantInUi(a.adminCookie, "medical");
    expect(await getPublicTenantIds()).toContain(tenant.id);

    expect(await setTenantFlag(a.adminCookie, tenant.id, "FF_PUBLIC_DIRECTORY", false)).toBe(200);

    expect(await getPublicTenantIds()).toEqual([a.existing.id]);
    // The directory itself is a separate switch and stays on.
    expect(await isFeatureEnabled("FF_DIRECTORY", { tenantId: tenant.id })).toBe(true);

    expect(await setTenantFlag(a.adminCookie, tenant.id, "FF_PUBLIC_DIRECTORY", true)).toBe(200);

    expect(await getPublicTenantIds()).toContain(tenant.id);
  });

  it("refuses a manager", async () => {
    const a = await arrange();
    const tenant = await createTenantInUi(a.adminCookie, "medical");
    const managerCookie = await a.addManager(tenant.id);

    expect(await setTenantFlag(managerCookie, tenant.id, "FF_DIRECTORY", false)).toBe(403);
    expect(
      await statusOf(() =>
        tenantFeaturesLoader({
          request: get(`/medical/tenants/${tenant.id}/features`, managerCookie),
          params: { tenant: "medical", tenantId: tenant.id },
          context: {},
        } as never),
      ),
    ).toBe(403);
    expect(await isFeatureEnabled("FF_DIRECTORY", { tenantId: tenant.id })).toBe(true);
  });

  it("rejects a flag that is not tenant-scoped", async () => {
    const a = await arrange();
    const tenant = await createTenantInUi(a.adminCookie, "medical");

    expect(await setTenantFlag(a.adminCookie, tenant.id, "FF_PWA", true)).toBe(400);
    expect(await setTenantFlag(a.adminCookie, tenant.id, "FF_NO_SUCH_FLAG", true)).toBe(400);
  });

  it("answers 404 for a tenant that does not exist", async () => {
    const a = await arrange();

    expect(await setTenantFlag(a.adminCookie, "no-such-tenant", "FF_DIRECTORY", true)).toBe(404);
  });
});
