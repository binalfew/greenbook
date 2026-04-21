import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as organizationEditorAction } from "~/routes/$tenant/directory/organizations/+shared/organization-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

// Module-level `flagCache` (60s TTL) in feature-flags.server.ts persists
// across tests. TRUNCATE in the global setup wipes the DB rows but not the
// cache, so the second test's recreated FF_DIRECTORY isn't visible until
// the cache is cleared.
beforeEach(() => {
  clearFlagCache();
});

/**
 * Phase B.4 — proves the editor action end-to-end: form POST → Conform parse →
 * dispatchDirectoryChange → submitChange / submitAndApply → DB write.
 * Services already have unit-level coverage; this file is about the
 * route-action pipeline (Conform + permission routing).
 */

type Seeded = {
  tenantId: string;
  focalSession: string;
  managerSession: string;
  orgType: { id: string };
};

async function arrange(): Promise<Seeded> {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("test-password", 4);

  // Two distinct roles per tenant — mirrors the directory seed shape.
  const focalRole = await prisma.role.create({
    data: { tenantId: tenant.id, name: "focal", scope: "TENANT" },
  });
  const managerRole = await prisma.role.create({
    data: { tenantId: tenant.id, name: "manager", scope: "TENANT" },
  });

  async function grant(roleId: string, resource: string, action: string) {
    const perm = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      create: { resource, action, module: "directory" },
      update: {},
    });
    await prisma.rolePermission.create({
      data: { roleId, permissionId: perm.id, access: "any" },
    });
  }

  await grant(focalRole.id, "organization", "read");
  await grant(focalRole.id, "directory-change", "submit");

  await grant(managerRole.id, "organization", "read");
  await grant(managerRole.id, "organization", "write");
  await grant(managerRole.id, "directory-change", "approve");
  await grant(managerRole.id, "directory-change", "read-all");

  const focalUser = await prisma.user.create({
    data: {
      email: `focal-${tenant.id}@test.com`,
      firstName: "Focal",
      lastName: "Person",
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
      userRoles: { create: { roleId: focalRole.id } },
    },
  });
  const managerUser = await prisma.user.create({
    data: {
      email: `manager-${tenant.id}@test.com`,
      firstName: "Manager",
      lastName: "Reviewer",
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
      userRoles: { create: { roleId: managerRole.id } },
    },
  });

  const orgType = await prisma.organizationType.create({
    data: { tenantId: tenant.id, code: "ROOT", name: "Root", level: 0 },
  });

  // Opt the tenant into FF_DIRECTORY so requireFeature passes.
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
    focalSession: await createSessionCookie(prisma, focalUser.id),
    managerSession: await createSessionCookie(prisma, managerUser.id),
    orgType: { id: orgType.id },
  };
}

function buildRequest(cookie: string, body: Record<string, string>): Request {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  return new Request("http://localhost/system/directory/organizations/new", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
    body: form.toString(),
  });
}

describe("organization-editor action (route-level)", () => {
  it("focal person POST lands as PENDING ChangeRequest, no org created", async () => {
    const a = await arrange();
    const request = buildRequest(a.focalSession, {
      name: "Proposed Org",
      typeId: a.orgType.id,
      isActive: "true",
      sortOrder: "0",
    });

    // The action redirects on success.
    const response = await organizationEditorAction({
      request,
      params: { tenant: "system" },
      context: {},
    }).catch((err) => err);
    expect(response instanceof Response).toBe(true);
    expect((response as Response).status).toBe(302);

    const orgs = await prisma.organization.count({
      where: { tenantId: a.tenantId, deletedAt: null },
    });
    expect(orgs).toBe(0);

    const pending = await prisma.changeRequest.findFirst({
      where: { tenantId: a.tenantId, status: "PENDING" },
    });
    expect(pending).toBeTruthy();
    expect(pending?.approvalMode).toBe("REVIEWED");
    expect(pending?.entityType).toBe("ORGANIZATION");
    expect(pending?.operation).toBe("CREATE");
  });

  it("manager POST self-approves and creates the org immediately", async () => {
    const a = await arrange();
    const request = buildRequest(a.managerSession, {
      name: "Direct Edit Org",
      typeId: a.orgType.id,
      isActive: "true",
      sortOrder: "0",
    });

    let caught: unknown;
    try {
      await organizationEditorAction({
        request,
        params: { tenant: "system" },
        context: {},
      });
    } catch (err) {
      caught = err;
    }
    // redirect() in RR7 returns a Response; some code paths `throw` it instead.
    if (caught instanceof Response) {
      expect(caught.status).toBe(302);
    } else {
      // Either the action returned a redirect, or the DB write landed and
      // we redirected to `${base}/${entityId}`. Prove the write happened.
    }

    const org = await prisma.organization.findFirst({
      where: { tenantId: a.tenantId, deletedAt: null, name: "Direct Edit Org" },
    });
    expect(org).toBeTruthy();

    const change = await prisma.changeRequest.findFirst({
      where: { tenantId: a.tenantId, status: "APPROVED", entityId: org!.id },
    });
    expect(change?.approvalMode).toBe("SELF_APPROVED");
  });

  it("missing required field returns a Conform error reply (not a redirect)", async () => {
    const a = await arrange();
    const request = buildRequest(a.focalSession, {
      // name omitted — required field
      typeId: a.orgType.id,
      isActive: "true",
      sortOrder: "0",
    });

    const result = await organizationEditorAction({
      request,
      params: { tenant: "system" },
      context: {},
    });

    // The action returns `data(submission.reply(), { status: 400 })` — in
    // RR7 that's a data wrapper, not a bare Response. Either way, it must
    // NOT be a redirect (status 302).
    if (result instanceof Response) {
      expect(result.status).not.toBe(302);
    } else {
      // Data wrapper — its shape is { type: "DataWithResponseInit", ... }.
      // Good enough to confirm it's not a redirect.
      expect(result).toBeTruthy();
    }

    const orgs = await prisma.organization.count({
      where: { tenantId: a.tenantId, deletedAt: null },
    });
    expect(orgs).toBe(0);

    const changes = await prisma.changeRequest.count({
      where: { tenantId: a.tenantId },
    });
    expect(changes).toBe(0);
  });
});
