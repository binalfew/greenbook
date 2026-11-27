import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as referencesLoader } from "~/routes/$tenant/settings/references/index";
import { action as newTenantAction } from "~/routes/$tenant/tenants/new";
import { csrf } from "~/utils/auth/csrf.server";
import { createSessionCookie } from "./helpers/session";

// Template features with no role in Greenbook: the Languages reference list
// and the tenant subscription plan.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const role = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  await prisma.role.createMany({
    data: [
      { name: "manager", scope: "TENANT" },
      { name: "focal", scope: "TENANT" },
      { name: "user", scope: "GLOBAL" },
    ],
  });
  const perm = await prisma.permission.create({
    data: { resource: "reference-data", action: "read", module: "system" },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionId: perm.id, access: "any" },
  });
  const admin = await prisma.user.create({
    data: {
      ...buildUser(),
      tenantId: system.id,
      userStatusId: status.id,
      userRoles: { create: { roleId: role.id } },
    },
  });
  return { cookie: await createSessionCookie(prisma, admin.id) };
}

const args = (request: Request) =>
  ({ request, params: { tenant: "system" }, context: {} }) as never;

async function post(cookie: string, fields: Record<string, string>) {
  const [token, csrfCookie] = await csrf.commitToken();
  const form = new URLSearchParams({ csrf: token, ...fields });
  return new Request("http://localhost/system/tenants/new", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookie ? `${cookie}; ${csrfCookie.split(";")[0]}` : cookie,
    },
    body: form.toString(),
  });
}

describe("template screens that are not part of Greenbook", () => {
  it("the reference data overview no longer offers Languages", async () => {
    const { cookie } = await arrange();
    const request = new Request("http://localhost/system/settings/references", {
      headers: { cookie },
    });
    const result = (await referencesLoader(args(request))) as unknown as {
      data: { counts: Record<string, number> };
    };
    expect(Object.keys(result.data.counts).sort()).toEqual([
      "memberStates",
      "organizationTypes",
      "positionTypes",
      "regionalGroups",
      "titles",
    ]);
  });

  it("a tenant is created without a subscription plan", async () => {
    const { cookie } = await arrange();
    const request = await post(cookie, {
      name: "Peace and Security",
      slug: "psc",
      email: "psc@test.com",
      phone: "+251-11-000-0000",
      subscriptionPlan: "enterprise",
    });
    const response = (await newTenantAction(args(request))) as Response;
    expect(response.status).toBe(302);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "psc" } });
    expect(tenant).not.toHaveProperty("subscriptionPlan");
  });
});
