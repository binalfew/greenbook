import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as approveAction } from "~/routes/$tenant/_directory/approvals/$changeId.approve";
import { action as rejectAction } from "~/routes/$tenant/_directory/approvals/$changeId.reject";
import { action as withdrawAction } from "~/routes/$tenant/_directory/submissions/$changeId.withdraw";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/submissions/submit-drafts";
import { action as personEditorAction } from "~/routes/$tenant/_directory/people/+shared/person-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { personForm } from "./helpers/directory-actors";
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

  await grant(focalRole.id, "person", "read");
  await grant(focalRole.id, "directory-change", "submit");

  await grant(managerRole.id, "person", "read");
  await grant(managerRole.id, "person", "write");
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

/** The audit trail of one change request, oldest first. */
async function auditTrail(a: Arranged, changeId: string) {
  const entries = await prisma.auditLog.findMany({
    where: { tenantId: a.tenantId, entityType: "ChangeRequest", entityId: changeId },
    orderBy: { createdAt: "asc" },
  });
  return entries.map((e) => ({ action: e.action, userId: e.userId }));
}

async function submitAsFocal(a: Arranged): Promise<string> {
  await run(() =>
    personEditorAction({
      request: post(`/${a.slug}/people/new`, a.focalSession, personForm("Proposed Person")),
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
      request: post(`/${a.slug}/submissions/submit-drafts`, a.focalSession, {
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
      message: "Fatou Focal asked to add a person",
      read: false,
    });
    expect(notifications[0].data).toMatchObject({ changeId });
  });

  it("submitting a change writes an audit entry", async () => {
    const a = await arrange();

    const changeId = await submitAsFocal(a);

    expect(await auditTrail(a, changeId)).toEqual([{ action: "SUBMIT_CHANGE", userId: a.focalId }]);
  });

  it("withdrawing a change writes an audit entry", async () => {
    const a = await arrange();
    const changeId = await submitAsFocal(a);

    const response = await run(() =>
      withdrawAction({
        request: post(`/${a.slug}/submissions/${changeId}/withdraw`, a.focalSession, {}),
        params: { tenant: a.slug, changeId },
        context: {},
      } as Parameters<typeof withdrawAction>[0]),
    );
    expect((response as Response).status).toBe(302);

    expect(await auditTrail(a, changeId)).toEqual([
      { action: "SUBMIT_CHANGE", userId: a.focalId },
      { action: "WITHDRAW_CHANGE", userId: a.focalId },
    ]);
  });

  it("approving a change notifies the submitter and writes an audit entry", async () => {
    const a = await arrange();
    const changeId = await submitAsFocal(a);

    const response = await run(() =>
      approveAction({
        request: post(`/${a.slug}/approvals/${changeId}/approve`, a.managerSession, {}),
        params: { tenant: a.slug, changeId },
        context: {},
      } as Parameters<typeof approveAction>[0]),
    );
    expect((response as Response).status).toBe(302);

    const published = await prisma.person.count({
      where: { tenantId: a.tenantId, lastName: "Proposed Person", deletedAt: null },
    });
    expect(published).toBe(1);

    const toSubmitter = await prisma.notification.findMany({ where: { userId: a.focalId } });
    expect(toSubmitter).toHaveLength(1);
    expect(toSubmitter[0]).toMatchObject({
      type: "directory.change.approved",
      message: "Musa Manager approved your request to add a person",
    });
    expect(toSubmitter[0].data).toMatchObject({ changeId, outcome: "APPROVED" });

    expect(await auditTrail(a, changeId)).toEqual([
      { action: "SUBMIT_CHANGE", userId: a.focalId },
      { action: "APPROVE_CHANGE", userId: a.managerId },
    ]);
  });

  it("rejecting a change notifies the submitter with the reason and writes an audit entry", async () => {
    const a = await arrange();
    const changeId = await submitAsFocal(a);

    const response = await run(() =>
      rejectAction({
        request: post(`/${a.slug}/approvals/${changeId}/reject`, a.managerSession, {
          notes: "Duplicate of an existing record",
        }),
        params: { tenant: a.slug, changeId },
        context: {},
      } as Parameters<typeof rejectAction>[0]),
    );
    expect((response as Response).status).toBe(302);

    const published = await prisma.person.count({ where: { tenantId: a.tenantId } });
    expect(published).toBe(0);

    const toSubmitter = await prisma.notification.findMany({ where: { userId: a.focalId } });
    expect(toSubmitter).toHaveLength(1);
    expect(toSubmitter[0]).toMatchObject({
      type: "directory.change.rejected",
      message:
        "Musa Manager rejected your request to add a person: Duplicate of an existing record",
    });
    expect(toSubmitter[0].data).toMatchObject({ changeId, outcome: "REJECTED" });

    expect(await auditTrail(a, changeId)).toEqual([
      { action: "SUBMIT_CHANGE", userId: a.focalId },
      { action: "REJECT_CHANGE", userId: a.managerId },
    ]);
  });
});
