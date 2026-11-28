import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as organizationEditorAction } from "~/routes/$tenant/_directory/organogram/+shared/organization-editor.server";
import { loader as peopleLoader } from "~/routes/$tenant/_directory/people/index";
import { loader as dashboardLoader } from "~/routes/$tenant/index";
import { loader as logDetailLoader } from "~/routes/$tenant/logs/$logId/index";
import { loader as logsLoader } from "~/routes/$tenant/logs/index";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

// Tenant-scoped pages act on the tenant named in the URL. A global admin may
// act on any tenant; a manager or focal person is confined to their own.

beforeEach(() => {
  clearFlagCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const [home, other] = await Promise.all([
    prisma.tenant.create({ data: buildTenant() }),
    prisma.tenant.create({ data: buildTenant() }),
  ]);

  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });

  const grants: [string, string, string[]][] = [
    ["organization", "read", [adminRole.id, managerRole.id, focalRole.id]],
    ["organization", "write", [adminRole.id, managerRole.id]],
    ["person", "read", [adminRole.id, managerRole.id, focalRole.id]],
    ["person", "write", [adminRole.id, managerRole.id]],
    ["directory-change", "submit", [adminRole.id, managerRole.id, focalRole.id]],
    ["directory-change", "read-all", [adminRole.id, managerRole.id]],
    ["directory-change", "approve", [adminRole.id, managerRole.id]],
    ["audit-log", "read", [adminRole.id, managerRole.id]],
  ];
  for (const [resource, action, roleIds] of grants) {
    const perm = await prisma.permission.create({
      data: { resource, action, module: "directory" },
    });
    await prisma.rolePermission.createMany({
      data: roleIds.map((roleId) => ({ roleId, permissionId: perm.id, access: "any" })),
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

  const admin = await mkUser(home.id, adminRole.id);
  const manager = await mkUser(home.id, managerRole.id);
  const focal = await mkUser(home.id, focalRole.id);

  await prisma.featureFlag.create({
    data: {
      key: "FF_DIRECTORY",
      scope: "tenant",
      enabled: true,
      enabledForTenants: [home.id, other.id],
    },
  });

  // Reference data is one set shared by every tenant.
  const homeOrgType = await prisma.organizationType.create({
    data: { code: "ROOT", name: "Root", level: 0 },
  });
  const otherOrgType = homeOrgType;

  await prisma.person.create({
    data: { tenantId: home.id, firstName: "Hana", lastName: "Home" },
  });
  await prisma.person.create({
    data: { tenantId: other.id, firstName: "Omar", lastName: "Other" },
  });

  const homeLog = await prisma.auditLog.create({
    data: { tenantId: home.id, action: "CREATE", entityType: "Person", description: "home entry" },
  });
  const otherLog = await prisma.auditLog.create({
    data: {
      tenantId: other.id,
      action: "CREATE",
      entityType: "Person",
      description: "other entry",
    },
  });

  return {
    home,
    other,
    homeOrgType,
    otherOrgType,
    homeLog,
    otherLog,
    adminCookie: await createSessionCookie(prisma, admin.id),
    managerCookie: await createSessionCookie(prisma, manager.id),
    focalCookie: await createSessionCookie(prisma, focal.id),
  };
}

function get(cookie: string, path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { cookie } });
}

function postOrg(cookie: string, slug: string, typeId: string, name: string): Request {
  return new Request(`http://localhost/${slug}/organogram/new`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ name, typeId, isActive: "true", sortOrder: "0" }).toString(),
  });
}

/** Run a loader/action and return its HTTP status, whether returned or thrown. */
async function statusOf(run: () => Promise<unknown>): Promise<number> {
  const result = await run().catch((thrown) => thrown);
  if (result instanceof Response) return result.status;
  const init = (result as { init?: { status?: number } | null }).init;
  return init?.status ?? 200;
}

type PeopleData = { data: { people: { lastName: string }[] } };
type LogsData = { data: { logs: { description: string | null }[]; kpi: { totalCount: number } } };

describe("global admin acts on the tenant in the URL", () => {
  it("lists the URL tenant's people, not the admin's home tenant's", async () => {
    const a = await arrange();
    const slug = a.other.slug;

    const result = (await peopleLoader({
      request: get(a.adminCookie, `/${slug}/people`),
      params: { tenant: slug },
      context: {},
    } as never)) as unknown as PeopleData;

    expect(result.data.people.map((p) => p.lastName)).toEqual(["Other"]);
  });

  it("counts the URL tenant's records on the dashboard", async () => {
    const a = await arrange();
    const slug = a.other.slug;
    await prisma.person.create({
      data: { tenantId: a.other.id, firstName: "Second", lastName: "Other" },
    });

    const result = (await dashboardLoader({
      request: get(a.adminCookie, `/${slug}`),
      params: { tenant: slug },
      context: {},
    } as never)) as unknown as {
      data: { directory: { counts: { personCount: number } } | null };
    };

    expect(result.data.directory?.counts.personCount).toBe(2);
  });

  it("creates an organization, shared by every tenant, from the URL tenant", async () => {
    const a = await arrange();
    const slug = a.other.slug;

    const status = await statusOf(() =>
      organizationEditorAction({
        request: postOrg(a.adminCookie, slug, a.otherOrgType.id, "Admin Made"),
        params: { tenant: slug },
        context: {},
      } as never),
    );

    expect(status).toBe(302);
    const orgs = await prisma.organization.findMany({ where: { name: "Admin Made" } });
    expect(orgs).toHaveLength(1);
    // The unit belongs to no tenant; the change that made it is on record in
    // the tenant the admin was working in.
    const changes = await prisma.changeRequest.findMany({ where: { entityId: orgs[0].id } });
    expect(changes.map((c) => c.tenantId)).toEqual([a.other.id]);
  });

  it("shows the URL tenant's audit log entries", async () => {
    const a = await arrange();
    const slug = a.other.slug;

    const result = (await logsLoader({
      request: get(a.adminCookie, `/${slug}/logs`),
      params: { tenant: slug },
      context: {},
    } as never)) as unknown as LogsData;

    expect(result.data.logs.map((l) => l.description)).toEqual(["other entry"]);
    expect(result.data.kpi.totalCount).toBe(1);
  });

  it("opens an audit log entry of the URL tenant, and not one of another tenant", async () => {
    const a = await arrange();
    const slug = a.other.slug;

    const own = await statusOf(() =>
      logDetailLoader({
        request: get(a.adminCookie, `/${slug}/logs/${a.otherLog.id}`),
        params: { tenant: slug, logId: a.otherLog.id },
        context: {},
      } as never),
    );
    const foreign = await statusOf(() =>
      logDetailLoader({
        request: get(a.adminCookie, `/${slug}/logs/${a.homeLog.id}`),
        params: { tenant: slug, logId: a.homeLog.id },
        context: {},
      } as never),
    );

    expect(own).toBe(200);
    expect(foreign).toBe(404);
  });

  it("gets a 404 for a tenant slug that does not exist", async () => {
    const a = await arrange();

    const status = await statusOf(() =>
      peopleLoader({
        request: get(a.adminCookie, "/no-such-tenant/people"),
        params: { tenant: "no-such-tenant" },
        context: {},
      } as never),
    );

    expect(status).toBe(404);
  });
});

describe("a manager or focal person is confined to their own tenant", () => {
  it("still reads their own tenant's people", async () => {
    const a = await arrange();
    const slug = a.home.slug;

    const result = (await peopleLoader({
      request: get(a.managerCookie, `/${slug}/people`),
      params: { tenant: slug },
      context: {},
    } as never)) as unknown as PeopleData;

    expect(result.data.people.map((p) => p.lastName)).toEqual(["Home"]);
  });

  it.each(["managerCookie", "focalCookie"] as const)(
    "%s is refused another tenant's directory",
    async (who) => {
      const a = await arrange();
      const slug = a.other.slug;

      const status = await statusOf(() =>
        peopleLoader({
          request: get(a[who], `/${slug}/people`),
          params: { tenant: slug },
          context: {},
        } as never),
      );

      expect(status).toBe(403);
    },
  );

  it.each(["managerCookie", "focalCookie"] as const)(
    "%s cannot write through another tenant's URL",
    async (who) => {
      const a = await arrange();
      const slug = a.other.slug;

      const status = await statusOf(() =>
        organizationEditorAction({
          request: postOrg(a[who], slug, a.otherOrgType.id, "Smuggled"),
          params: { tenant: slug },
          context: {},
        } as never),
      );

      expect(status).toBe(403);
      expect(await prisma.organization.count()).toBe(0);
      expect(await prisma.changeRequest.count()).toBe(0);
    },
  );

  it("a manager is refused another tenant's audit log, list and entry", async () => {
    const a = await arrange();
    const slug = a.other.slug;

    const list = await statusOf(() =>
      logsLoader({
        request: get(a.managerCookie, `/${slug}/logs`),
        params: { tenant: slug },
        context: {},
      } as never),
    );
    const entry = await statusOf(() =>
      logDetailLoader({
        request: get(a.managerCookie, `/${slug}/logs/${a.otherLog.id}`),
        params: { tenant: slug, logId: a.otherLog.id },
        context: {},
      } as never),
    );

    expect(list).toBe(403);
    expect(entry).toBe(403);
  });

  it("a manager still reads their own tenant's audit log", async () => {
    const a = await arrange();
    const slug = a.home.slug;

    const result = (await logsLoader({
      request: get(a.managerCookie, `/${slug}/logs`),
      params: { tenant: slug },
      context: {},
    } as never)) as unknown as LogsData;

    expect(result.data.logs.map((l) => l.description)).toEqual(["home entry"]);
  });
});
