import { afterEach, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import {
  approveChange,
  approveChanges,
  ChangeRequestError,
  rejectChange,
  submitAndApply,
  submitChange,
  withdrawChange,
} from "~/services/directory-changes.server";
import { clearPublicTenantIdsCache, getPublicTenantIds } from "~/services/public-directory.server";
import { publicListOrganizationTreeRoots } from "~/services/organizations.server";

/**
 * Directory change-request engine — Phase A integration tests.
 *
 * These tests exercise the full submit → approve/reject/withdraw → apply
 * pipeline against a real Postgres instance. Every write goes through the
 * change-request engine; entity services' internal `_apply*` writers are
 * never called directly.
 */

type Arranged = {
  tenant: { id: string };
  otherTenant: { id: string };
  focalUser: { id: string };
  managerUser: { id: string };
  orgType: { id: string };
  positionType: { id: string };
};

async function arrange(): Promise<Arranged> {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const otherTenant = await prisma.tenant.create({ data: buildTenant() });

  const passwordHash = await hash("test-password", 4);

  const focalUser = await prisma.user.create({
    data: {
      email: `focal-${tenant.id}@test.com`,
      firstName: "Focal",
      lastName: "Person",
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
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
    },
  });

  const orgType = await prisma.organizationType.create({
    data: {
      tenantId: tenant.id,
      code: "ROOT",
      name: "Root",
      level: 0,
    },
  });

  const positionType = await prisma.positionType.create({
    data: {
      tenantId: tenant.id,
      code: "DIRECTOR",
      name: "Director",
      hierarchyLevel: 3,
    },
  });

  // Mirror the org + position type into the other tenant so we can assert
  // tenant isolation on reads/conflicts without cross-tenant bleed.
  await prisma.organizationType.create({
    data: { tenantId: otherTenant.id, code: "ROOT", name: "Root", level: 0 },
  });

  return {
    tenant: { id: tenant.id },
    otherTenant: { id: otherTenant.id },
    focalUser: { id: focalUser.id },
    managerUser: { id: managerUser.id },
    orgType: { id: orgType.id },
    positionType: { id: positionType.id },
  };
}

function focalCtx(a: Arranged) {
  return { tenantId: a.tenant.id, userId: a.focalUser.id };
}
function managerCtx(a: Arranged) {
  return { tenantId: a.tenant.id, userId: a.managerUser.id };
}

// ─────────────────────────────────────────────────────────────────────────

describe("directory-changes: submit → approve round-trip", () => {
  it("creates an Organization only after manager approval", async () => {
    const a = await arrange();

    const change = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: {
          name: "New Org",
          typeId: a.orgType.id,
          isActive: true,
        },
      },
      focalCtx(a),
    );

    expect(change.status).toBe("PENDING");
    expect(change.entityId).toBeNull();

    // Before approval — nothing exists yet.
    let orgCount = await prisma.organization.count({
      where: { tenantId: a.tenant.id, deletedAt: null },
    });
    expect(orgCount).toBe(0);

    const result = await approveChange(change.id, { notes: "looks good" }, managerCtx(a));
    expect(result.change.status).toBe("APPROVED");
    expect(result.change.entityId).toBeTruthy();
    expect(result.change.reviewedById).toBe(a.managerUser.id);
    expect(result.change.approvalMode).toBe("REVIEWED");
    expect(result.change.appliedAt).toBeTruthy();

    orgCount = await prisma.organization.count({
      where: { tenantId: a.tenant.id, deletedAt: null },
    });
    expect(orgCount).toBe(1);

    const org = await prisma.organization.findFirst({
      where: { tenantId: a.tenant.id, deletedAt: null },
    });
    expect(org?.name).toBe("New Org");
  });

  it("rejects a submission and leaves the entity untouched", async () => {
    const a = await arrange();
    const change = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Reject Me", typeId: a.orgType.id, isActive: true },
      },
      focalCtx(a),
    );

    const rejected = await rejectChange(change.id, { notes: "missing mandate" }, managerCtx(a));
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reviewerNotes).toBe("missing mandate");

    const count = await prisma.organization.count({
      where: { tenantId: a.tenant.id, deletedAt: null },
    });
    expect(count).toBe(0);
  });
});

describe("directory-changes: concurrency + conflict guards", () => {
  it("prevents a second PENDING request against the same entity", async () => {
    const a = await arrange();
    // First approve an org so there's something to edit.
    const created = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Initial", typeId: a.orgType.id, isActive: true },
      },
      managerCtx(a),
    );
    const orgId = (created.entity as { id: string }).id;

    await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "UPDATE",
        entityId: orgId,
        payload: { name: "Renamed", typeId: a.orgType.id, isActive: true },
      },
      focalCtx(a),
    );

    await expect(
      submitChange(
        {
          entityType: "ORGANIZATION",
          operation: "UPDATE",
          entityId: orgId,
          payload: { name: "Renamed Again", typeId: a.orgType.id, isActive: true },
        },
        focalCtx(a),
      ),
    ).rejects.toThrow(/pending change already exists/i);
  });

  it("rejects a cycle on UPDATE with parentId", async () => {
    const a = await arrange();

    const parent = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Parent", typeId: a.orgType.id, isActive: true },
      },
      managerCtx(a),
    );
    const parentId = (parent.entity as { id: string }).id;

    const child = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: {
          name: "Child",
          typeId: a.orgType.id,
          parentId,
          isActive: true,
        },
      },
      managerCtx(a),
    );
    const childId = (child.entity as { id: string }).id;

    // Parent can't be reparented under Child (cycle).
    const cyclic = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "MOVE",
        entityId: parentId,
        payload: { parentId: childId },
      },
      focalCtx(a),
    );
    await expect(approveChange(cyclic.id, {}, managerCtx(a))).rejects.toThrow(/cycle|circular/i);

    // After the failed apply the change request is still PENDING.
    const stillPending = await prisma.changeRequest.findUnique({
      where: { id: cyclic.id },
    });
    expect(stillPending?.status).toBe("PENDING");
  });

  it("surfaces invalid references at approve time, not submit", async () => {
    // submitChange only validates payload shape — the approval path
    // re-checks referenced records against the live DB. This keeps
    // submission cheap and lets managers see bad references at review time.
    const a = await arrange();
    const pending = await submitChange(
      {
        entityType: "POSITION",
        operation: "CREATE",
        payload: {
          organizationId: "nonexistent",
          typeId: a.positionType.id,
          title: "Ghost Director",
          isActive: true,
        },
      },
      focalCtx(a),
    );
    expect(pending.status).toBe("PENDING");

    await expect(approveChange(pending.id, {}, managerCtx(a))).rejects.toMatchObject({
      code: "REFERENCED_RECORD_NOT_PUBLISHED",
    });
    const stillPending = await prisma.changeRequest.findUnique({ where: { id: pending.id } });
    expect(stillPending?.status).toBe("PENDING");
  });
});

describe("directory-changes: withdraw ownership", () => {
  it("allows the submitter to withdraw", async () => {
    const a = await arrange();
    const change = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Withdraw Me", typeId: a.orgType.id, isActive: true },
      },
      focalCtx(a),
    );

    const withdrawn = await withdrawChange(change.id, focalCtx(a));
    expect(withdrawn.status).toBe("WITHDRAWN");
  });

  it("forbids non-submitters (including managers) from withdrawing", async () => {
    const a = await arrange();
    const change = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Not Yours", typeId: a.orgType.id, isActive: true },
      },
      focalCtx(a),
    );
    await expect(withdrawChange(change.id, managerCtx(a))).rejects.toThrow(/only the submitter/i);
  });
});

describe("directory-changes: manager self-approve (submitAndApply)", () => {
  it("creates and applies in one atomic step with SELF_APPROVED audit mark", async () => {
    const a = await arrange();
    const { change, entity } = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Direct Edit", typeId: a.orgType.id, isActive: true },
      },
      managerCtx(a),
    );

    expect(change.status).toBe("APPROVED");
    expect(change.approvalMode).toBe("SELF_APPROVED");
    expect(change.reviewedById).toBe(a.managerUser.id);
    expect(change.submittedById).toBe(a.managerUser.id);
    expect(change.entityId).toBe((entity as { id: string }).id);
  });
});

describe("directory-changes: batch approval", () => {
  it("processes items per-id atomically, isolating failures", async () => {
    const a = await arrange();

    // Five good CREATE submissions + one invalid (typeId refers to another tenant).
    const good: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await submitChange(
        {
          entityType: "ORGANIZATION",
          operation: "CREATE",
          payload: { name: `Org ${i}`, typeId: a.orgType.id, isActive: true },
        },
        focalCtx(a),
      );
      good.push(c.id);
    }
    const otherTypeRow = await prisma.organizationType.findFirstOrThrow({
      where: { tenantId: a.otherTenant.id, code: "ROOT" },
    });
    const bad = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: {
          name: "Bad",
          typeId: otherTypeRow.id,
          isActive: true,
        },
      },
      focalCtx(a),
    );

    // One already-terminal id (WITHDRAWN) — should be skipped.
    const preWithdraw = await submitChange(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Pre-withdrawn", typeId: a.orgType.id, isActive: true },
      },
      focalCtx(a),
    );
    await withdrawChange(preWithdraw.id, focalCtx(a));

    const result = await approveChanges(
      [...good, bad.id, preWithdraw.id],
      { notes: "batch" },
      managerCtx(a),
    );
    expect(result.succeeded).toHaveLength(5);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(bad.id);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({ id: preWithdraw.id, reason: "NOT_PENDING" });

    const count = await prisma.organization.count({
      where: { tenantId: a.tenant.id, deletedAt: null },
    });
    expect(count).toBe(5);
  });
});

describe("directory-changes: cross-tenant public gate", () => {
  // The global integration TRUNCATE in beforeEach already wipes FeatureFlag
  // rows, but we also clear the module-level cache so tests don't see stale
  // tenant ids from a previous run.
  afterEach(() => {
    clearPublicTenantIdsCache();
  });

  it("excludes opted-out tenants from public helpers", async () => {
    const a = await arrange();
    clearPublicTenantIdsCache();

    // Create orgs in both tenants via self-approve.
    await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Public-Visible Root", typeId: a.orgType.id, isActive: true },
      },
      managerCtx(a),
    );
    const otherTypeRow = await prisma.organizationType.findFirstOrThrow({
      where: { tenantId: a.otherTenant.id, code: "ROOT" },
    });
    await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Secret Root", typeId: otherTypeRow.id, isActive: true },
      },
      { tenantId: a.otherTenant.id, userId: a.managerUser.id },
    );

    // Seed the public-directory flag: opt IN `tenant`, leave `otherTenant` out.
    await prisma.featureFlag.upsert({
      where: { key: "FF_PUBLIC_DIRECTORY" },
      update: { enabledForTenants: { set: [a.tenant.id] }, scope: "tenant", enabled: false },
      create: {
        key: "FF_PUBLIC_DIRECTORY",
        scope: "tenant",
        enabled: false,
        enabledForTenants: [a.tenant.id],
      },
    });
    clearPublicTenantIdsCache();

    const publicIds = await getPublicTenantIds();
    expect(publicIds).toEqual([a.tenant.id]);

    const roots = await publicListOrganizationTreeRoots(publicIds);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe("Public-Visible Root");
    // Response shape MUST NOT include tenantId.
    expect((roots[0] as Record<string, unknown>).tenantId).toBeUndefined();
  });

  it("returns empty set when no tenants opt in", async () => {
    clearPublicTenantIdsCache();
    await prisma.featureFlag.deleteMany({ where: { key: "FF_PUBLIC_DIRECTORY" } });
    const ids = await getPublicTenantIds();
    expect(ids).toEqual([]);
    const roots = await publicListOrganizationTreeRoots(ids);
    expect(roots).toEqual([]);
  });
});

describe("ChangeRequestError type", () => {
  it("carries status + code", () => {
    const err = new ChangeRequestError("nope", 409, "PENDING_REQUEST_EXISTS");
    expect(err.status).toBe(409);
    expect(err.code).toBe("PENDING_REQUEST_EXISTS");
    expect(err instanceof Error).toBe(true);
  });
});
