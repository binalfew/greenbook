import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as changeDetailLoader } from "~/routes/$tenant/directory/approvals/$changeId._layout";
import { action as submitDraftsAction } from "~/routes/$tenant/directory/approvals/submit-drafts";
import { action as organizationEditorAction } from "~/routes/$tenant/directory/organizations/+shared/organization-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

beforeEach(() => {
  clearFlagCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("test-password", 4);

  async function createUser(roleName: string, permissions: [string, string][]) {
    const role = await prisma.role.create({
      data: { tenantId: tenant.id, name: roleName, scope: "TENANT" },
    });
    for (const [resource, action] of permissions) {
      const perm = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action, module: "directory" },
        update: {},
      });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id, access: "any" },
      });
    }
    const user = await prisma.user.create({
      data: {
        email: `${roleName}-${tenant.id}@test.com`,
        firstName: roleName,
        lastName: "User",
        tenantId: tenant.id,
        userStatusId: status.id,
        password: { create: { hash: passwordHash } },
        userRoles: { create: { roleId: role.id } },
      },
    });
    return createSessionCookie(prisma, user.id);
  }

  const focalSession = await createUser("focal", [
    ["organization", "read"],
    ["directory-change", "submit"],
    ["directory-change", "read-own"],
  ]);
  const managerSession = await createUser("manager", [
    ["organization", "read"],
    ["organization", "write"],
    ["directory-change", "submit"],
    ["directory-change", "read-all"],
    ["directory-change", "approve"],
  ]);

  const orgType = await prisma.organizationType.create({
    data: { tenantId: tenant.id, code: "ROOT", name: "Root", level: 0 },
  });

  await prisma.featureFlag.upsert({
    where: { key: "FF_DIRECTORY" },
    create: {
      key: "FF_DIRECTORY",
      scope: "tenant",
      enabled: false,
      enabledForTenants: [tenant.id],
    },
    update: { enabledForTenants: { set: [tenant.id] } },
  });

  // The focal person proposes an organization; the change waits for review.
  const form = new URLSearchParams({
    name: "Proposed Org",
    typeId: orgType.id,
    isActive: "true",
    sortOrder: "0",
  });
  await organizationEditorAction({
    request: new Request(`http://localhost/${tenant.slug}/directory/organizations/new`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: focalSession },
      body: form.toString(),
    }),
    params: { tenant: tenant.slug },
    context: {},
  } as never).catch((thrown) => thrown);

  // The save is a draft; the focal person sends it for review.
  const change = await prisma.changeRequest.findFirstOrThrow({
    where: { tenantId: tenant.id, status: "DRAFT" },
  });
  await submitDraftsAction({
    request: new Request(`http://localhost/${tenant.slug}/directory/approvals/submit-drafts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: focalSession },
      body: new URLSearchParams({ "ids[]": change.id }).toString(),
    }),
    params: { tenant: tenant.slug },
    context: {},
  } as never);

  return { slug: tenant.slug, changeId: change.id, focalSession, managerSession };
}

async function loadChangeDetail(slug: string, changeId: string, cookie: string) {
  const result = await changeDetailLoader({
    request: new Request(`http://localhost/${slug}/directory/approvals/${changeId}`, {
      headers: { cookie },
    }),
    params: { tenant: slug, changeId },
    context: {},
  } as never);
  return (result as unknown as { data: { backHref: string } }).data;
}

describe("change detail page Back link", () => {
  it("returns a focal person to their submissions list", async () => {
    const a = await arrange();

    const detail = await loadChangeDetail(a.slug, a.changeId, a.focalSession);

    expect(detail.backHref).toBe(`/${a.slug}/directory/submissions`);
  });

  it("returns a manager to the approvals queue", async () => {
    const a = await arrange();

    const detail = await loadChangeDetail(a.slug, a.changeId, a.managerSession);

    expect(detail.backHref).toBe(`/${a.slug}/directory/approvals`);
  });
});
