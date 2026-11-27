import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as approveAction } from "~/routes/$tenant/directory/approvals/$changeId.approve";
import { action as rejectAction } from "~/routes/$tenant/directory/approvals/$changeId.reject";
import { action as submitDraftsAction } from "~/routes/$tenant/directory/approvals/submit-drafts";
import { action as organizationEditorAction } from "~/routes/$tenant/directory/organizations/+shared/organization-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

beforeEach(() => {
  clearFlagCache();
});

/**
 * The editorial workflow tells people what happened (in-app notifications)
 * and leaves a trail (audit log). Both must hold regardless of which other
 * consumers of the workflow's domain events exist.
 */

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("test-password", 4);

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
    await prisma.rolePermission.create({
      data: { roleId, permissionId: perm.id, access: "any" },
    });
  }

  await grant(focalRole.id, "organization", "read");
  await grant(focalRole.id, "directory-change", "submit");

  await grant(managerRole.id, "organization", "read");
  await grant(managerRole.id, "organization", "write");
  await grant(managerRole.id, "directory-change", "read-all");
  await grant(managerRole.id, "directory-change", "approve");
  await grant(managerRole.id, "directory-change", "reject");

  const focal = await prisma.user.create({
    data: {
      email: `focal-${tenant.id}@test.com`,
      firstName: "Fatou",
      lastName: "Focal",
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
      userRoles: { create: { roleId: focalRole.id } },
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `manager-${tenant.id}@test.com`,
      firstName: "Musa",
      lastName: "Manager",
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
      userRoles: { create: { roleId: managerRole.id } },
    },
  });

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

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    focalId: focal.id,
    managerId: manager.id,
    focalSession: await createSessionCookie(prisma, focal.id),
    managerSession: await createSessionCookie(prisma, manager.id),
    orgTypeId: orgType.id,
  };
}

function post(url: string, cookie: string, body: Record<string, string>): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(body).toString(),
  });
}

/** Runs a route action and returns its Response whether returned or thrown. */
async function run(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

type Arranged = Awaited<ReturnType<typeof arrange>>;

async function submitAsFocal(a: Arranged): Promise<string> {
  await run(() =>
    organizationEditorAction({
      request: post(`/${a.slug}/directory/organizations/new`, a.focalSession, {
        name: "Proposed Org",
        typeId: a.orgTypeId,
        isActive: "true",
        sortOrder: "0",
      }),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  // The save is a draft; the focal person sends it for review.
  const change = await prisma.changeRequest.findFirstOrThrow({
    where: { tenantId: a.tenantId, status: "DRAFT" },
  });
  await run(() =>
    submitDraftsAction({
      request: post(`/${a.slug}/directory/approvals/submit-drafts`, a.focalSession, {
        "ids[]": change.id,
      }),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  return change.id;
}

describe("directory workflow notifications and audit trail", () => {
  it("submitting a change notifies the tenant's approvers, not the submitter", async () => {
    const a = await arrange();

    const changeId = await submitAsFocal(a);

    const notifications = await prisma.notification.findMany({
      where: { tenantId: a.tenantId },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      userId: a.managerId,
      type: "directory.change.submitted",
      message: "Fatou Focal submitted a CREATE for ORGANIZATION",
      read: false,
    });
    expect(notifications[0].data).toMatchObject({ changeId });
  });

  it("approving a change notifies the submitter and writes an audit entry", async () => {
    const a = await arrange();
    const changeId = await submitAsFocal(a);

    const response = await run(() =>
      approveAction({
        request: post(`/${a.slug}/directory/approvals/${changeId}/approve`, a.managerSession, {}),
        params: { tenant: a.slug, changeId },
        context: {},
      } as Parameters<typeof approveAction>[0]),
    );
    expect((response as Response).status).toBe(302);

    const published = await prisma.organization.count({
      where: { tenantId: a.tenantId, name: "Proposed Org", deletedAt: null },
    });
    expect(published).toBe(1);

    const toSubmitter = await prisma.notification.findMany({ where: { userId: a.focalId } });
    expect(toSubmitter).toHaveLength(1);
    expect(toSubmitter[0]).toMatchObject({
      type: "directory.change.approved",
      message: "Musa Manager approved your CREATE for ORGANIZATION",
    });
    expect(toSubmitter[0].data).toMatchObject({ changeId, outcome: "APPROVED" });

    const audit = await prisma.auditLog.findMany({
      where: { tenantId: a.tenantId, entityType: "ChangeRequest", entityId: changeId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "APPROVE_CHANGE", userId: a.managerId });
  });

  it("rejecting a change notifies the submitter with the reason and writes an audit entry", async () => {
    const a = await arrange();
    const changeId = await submitAsFocal(a);

    const response = await run(() =>
      rejectAction({
        request: post(`/${a.slug}/directory/approvals/${changeId}/reject`, a.managerSession, {
          notes: "Duplicate of an existing office",
        }),
        params: { tenant: a.slug, changeId },
        context: {},
      } as Parameters<typeof rejectAction>[0]),
    );
    expect((response as Response).status).toBe(302);

    const published = await prisma.organization.count({ where: { tenantId: a.tenantId } });
    expect(published).toBe(0);

    const toSubmitter = await prisma.notification.findMany({ where: { userId: a.focalId } });
    expect(toSubmitter).toHaveLength(1);
    expect(toSubmitter[0]).toMatchObject({
      type: "directory.change.rejected",
      message:
        "Musa Manager rejected your CREATE for ORGANIZATION: Duplicate of an existing office",
    });
    expect(toSubmitter[0].data).toMatchObject({ changeId, outcome: "REJECTED" });

    const audit = await prisma.auditLog.findMany({
      where: { tenantId: a.tenantId, entityType: "ChangeRequest", entityId: changeId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "REJECT_CHANGE", userId: a.managerId });
  });
});
