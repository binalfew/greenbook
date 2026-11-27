import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as changeDetailLoader } from "~/routes/$tenant/directory/approvals/$changeId._layout";
import { action as submitDraftsAction } from "~/routes/$tenant/directory/approvals/submit-drafts";
import { action as organizationEditorAction } from "~/routes/$tenant/directory/organizations/+shared/organization-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

// Ticket #17, suspicion 2: the approval diff compares the stored record with
// the submitted form values. A date the focal person did not touch must not
// be listed as a change.

beforeEach(() => {
  clearFlagCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });

  const focalRole = await prisma.role.create({
    data: { name: "focal", scope: "TENANT" },
  });
  const managerRole = await prisma.role.create({
    data: { name: "manager", scope: "TENANT" },
  });

  async function grant(roleId: string, resource: string, action: string) {
    const perm = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      create: { resource, action, module: "directory" },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId: perm.id, access: "any" } });
  }
  await grant(focalRole.id, "organization", "read");
  await grant(focalRole.id, "directory-change", "submit");
  await grant(managerRole.id, "organization", "read");
  await grant(managerRole.id, "directory-change", "read-all");

  const mkUser = (roleId: string) =>
    prisma.user.create({
      data: {
        ...buildUser(),
        tenantId: tenant.id,
        userStatusId: status.id,
        userRoles: { create: { roleId } },
      },
    });
  const focal = await mkUser(focalRole.id);
  const manager = await mkUser(managerRole.id);

  const orgType = await prisma.organizationType.create({
    data: { tenantId: tenant.id, code: "ROOT", name: "Root", level: 0 },
  });
  const org = await prisma.organization.create({
    data: {
      tenantId: tenant.id,
      name: "Peace and Security Council",
      typeId: orgType.id,
      establishmentDate: new Date("2002-07-09"),
    },
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

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    org,
    orgType,
    focalCookie: await createSessionCookie(prisma, focal.id),
    managerCookie: await createSessionCookie(prisma, manager.id),
  };
}

type Arranged = Awaited<ReturnType<typeof arrange>>;

/** Focal person submits the organization edit form; manager opens the change. */
async function diffAfterEdit(a: Arranged, overrides: Record<string, string>) {
  const form = new URLSearchParams({
    id: a.org.id,
    name: a.org.name,
    typeId: a.orgType.id,
    establishmentDate: "2002-07-09",
    isActive: "true",
    sortOrder: "0",
    ...overrides,
  });
  const submit = new Request(`http://localhost/${a.slug}/directory/organizations/x/edit`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: a.focalCookie },
    body: form.toString(),
  });
  const response = await organizationEditorAction({
    request: submit,
    params: { tenant: a.slug },
    context: {},
  } as never);
  expect((response as Response).status).toBe(302);

  // The save is a draft; the focal person sends it for review.
  const change = await prisma.changeRequest.findFirstOrThrow({
    where: { tenantId: a.tenantId, entityId: a.org.id, status: "DRAFT" },
  });
  await submitDraftsAction({
    request: new Request(`http://localhost/${a.slug}/directory/approvals/submit-drafts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: a.focalCookie },
      body: new URLSearchParams({ "ids[]": change.id }).toString(),
    }),
    params: { tenant: a.slug },
    context: {},
  } as never);
  const detail = (await changeDetailLoader({
    request: new Request(`http://localhost/${a.slug}/directory/approvals/x`, {
      headers: { cookie: a.managerCookie },
    }),
    params: { tenant: a.slug, changeId: change.id },
    context: {},
  } as never)) as { data: { diffs: { field: string; before: unknown; after: unknown }[] } };
  return detail.data.diffs;
}

describe("approval diff for an organization edit", () => {
  it("omits a date the focal person did not change", async () => {
    const a = await arrange();
    const diffs = await diffAfterEdit(a, { name: "Peace & Security Council" });
    expect(diffs.map((d) => d.field)).toEqual(["name"]);
  });

  it("lists a date the focal person changed", async () => {
    const a = await arrange();
    const diffs = await diffAfterEdit(a, { establishmentDate: "2004-05-25" });
    expect(diffs.map((d) => d.field)).toEqual(["establishmentDate"]);
  });
});
