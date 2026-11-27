import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as changeDetailLoader } from "~/routes/$tenant/_directory/approvals/$changeId._layout";
import { loader as submissionDetailLoader } from "~/routes/$tenant/_directory/submissions/$changeId._layout";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/submissions/submit-drafts";
import { action as organizationEditorAction } from "~/routes/$tenant/_directory/organogram/+shared/organization-editor.server";
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
    data: { code: "ROOT", name: "Root", level: 0 },
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
    request: new Request(`http://localhost/${tenant.slug}/organogram/new`, {
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
    request: new Request(`http://localhost/${tenant.slug}/submissions/submit-drafts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: focalSession },
      body: new URLSearchParams({ "ids[]": change.id }).toString(),
    }),
    params: { tenant: tenant.slug },
    context: {},
  } as never);

  return { slug: tenant.slug, changeId: change.id, focalSession, managerSession };
}

type Section = "approvals" | "submissions";

/** Open a change on the reviewer's page or the author's; a redirect comes back as its target. */
async function openChange(section: Section, slug: string, changeId: string, cookie: string) {
  const loader = section === "approvals" ? changeDetailLoader : submissionDetailLoader;
  const result = await loader({
    request: new Request(`http://localhost/${slug}/${section}/${changeId}`, {
      headers: { cookie },
    }),
    params: { tenant: slug, changeId },
    context: {},
  } as never).catch((thrown) => thrown);
  if (result instanceof Response) return { redirectedTo: result.headers.get("Location") };
  return (result as unknown as { data: { backHref: string } }).data;
}

describe("change detail page Back link", () => {
  it("returns a focal person from their submission to their submissions list", async () => {
    const a = await arrange();

    const detail = await openChange("submissions", a.slug, a.changeId, a.focalSession);

    expect(detail).toMatchObject({ backHref: `/${a.slug}/submissions` });
  });

  it("returns a manager from the review page to the approvals queue", async () => {
    const a = await arrange();

    const detail = await openChange("approvals", a.slug, a.changeId, a.managerSession);

    expect(detail).toMatchObject({ backHref: `/${a.slug}/approvals` });
  });

  it("sends a focal person who opens the review page to their own submission", async () => {
    const a = await arrange();

    const detail = await openChange("approvals", a.slug, a.changeId, a.focalSession);

    expect(detail).toEqual({ redirectedTo: `/${a.slug}/submissions/${a.changeId}` });
  });

  it("does not show a manager someone else's submission on the author's page", async () => {
    const a = await arrange();

    const result = await submissionDetailLoader({
      request: new Request(`http://localhost/${a.slug}/submissions/${a.changeId}`, {
        headers: { cookie: a.managerSession },
      }),
      params: { tenant: a.slug, changeId: a.changeId },
      context: {},
    } as never).catch((thrown) => thrown);

    expect((result as Response).status).toBe(404);
  });
});
