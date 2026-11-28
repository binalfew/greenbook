import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../setup/integration-setup";

import { action as moveAction } from "~/routes/$tenant/_directory/api/organizations.move";
import { action as approveAction } from "~/routes/$tenant/_directory/approvals/$changeId.approve";
import { action as rejectAction } from "~/routes/$tenant/_directory/approvals/$changeId.reject";
import { action as batchApproveAction } from "~/routes/$tenant/_directory/approvals/batch-approve";
import { loader as organizationLoader } from "~/routes/$tenant/_directory/organogram/$orgId._layout";
import { loader as deleteOrganizationLoader } from "~/routes/$tenant/_directory/organogram/$orgId.delete";
import { action as deleteOrganizationAction } from "~/routes/$tenant/_directory/organogram/$orgId.delete";
import { loader as editOrganizationLoader } from "~/routes/$tenant/_directory/organogram/$orgId_/edit";
import { action as organizationEditorAction } from "~/routes/$tenant/_directory/organogram/+shared/organization-editor.server";
import { loader as organogramLoader } from "~/routes/$tenant/_directory/organogram/index";
import { loader as newOrganizationLoader } from "~/routes/$tenant/_directory/organogram/new";
import { loader as treeLoader } from "~/routes/$tenant/_directory/organogram/tree";
import { loader as positionLoader } from "~/routes/$tenant/_directory/positions/$positionId._layout";
import { action as assignAction } from "~/routes/$tenant/_directory/positions/$positionId.assign";
import { loader as deletePositionLoader } from "~/routes/$tenant/_directory/positions/$positionId.delete";
import { action as deletePositionAction } from "~/routes/$tenant/_directory/positions/$positionId.delete";
import { loader as editPositionLoader } from "~/routes/$tenant/_directory/positions/$positionId_/edit";
import { action as positionEditorAction } from "~/routes/$tenant/_directory/positions/+shared/position-editor.server";
import { loader as positionsLoader } from "~/routes/$tenant/_directory/positions/index";
import { loader as newPositionLoader } from "~/routes/$tenant/_directory/positions/new";
import { action as reopenAction } from "~/routes/$tenant/_directory/submissions/$changeId.reopen";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/submissions/submit-drafts";
import { action as withdrawAction } from "~/routes/$tenant/_directory/submissions/$changeId.withdraw";
import { rejectChange, saveDraft, submitDrafts } from "~/services/directory-changes.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { buildTenant } from "../factories";
import {
  enableDirectory,
  grantPermissions,
  MANAGER_PERMISSIONS,
  seedDirectoryActors,
  type Actor,
} from "./helpers/directory-actors";
import { get, payloadOf, post, routeArgs, run, statusOf, type FormBody } from "./helpers/requests";

// The organogram and the positions are kept by the global admin alone. Focal
// persons and managers read them, and go on proposing and approving people
// and assignments; they cannot create, edit, move or delete a unit or a post,
// through the pages or by posting to them.

beforeEach(() => clearFlagCache());

const ADMIN_MANAGED_EN =
  "Organizational units and positions are managed by the system administrator.";

type Handler = (args: never) => Promise<unknown>;
type Arranged = Awaited<ReturnType<typeof arrange>>;

async function arrange() {
  const a = await seedDirectoryActors(prisma);
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  await grantPermissions(prisma, adminRole.id, [
    ...MANAGER_PERMISSIONS,
    ["organization", "write"],
    ["organization", "delete"],
    ["position", "write"],
    ["position", "delete"],
  ]);
  const admin = await a.member("admin", adminRole.id);

  const positionType = await prisma.positionType.create({
    data: { code: "DIRECTOR", name: "Director" },
  });
  const org = await prisma.organization.create({
    data: { name: "Secretariat", typeId: a.orgTypeId },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: "Registry", typeId: a.orgTypeId },
  });
  const position = await prisma.position.create({
    data: {
      organizationId: org.id,
      typeId: positionType.id,
      title: "Director",
    },
  });
  const person = await prisma.person.create({
    data: { tenantId: a.tenantId, firstName: "Amina", lastName: "Diallo", languages: [] },
  });
  return { ...a, admin, org, otherOrg, position, person, positionTypeId: positionType.id };
}

const orgForm = (a: Arranged, name: string, extra: FormBody = {}) => ({
  name,
  typeId: a.orgTypeId,
  isActive: "true",
  sortOrder: "0",
  ...extra,
});

const positionForm = (a: Arranged, title: string, extra: FormBody = {}) => ({
  organizationId: a.org.id,
  typeId: a.positionTypeId,
  title,
  isActive: "true",
  sortOrder: "0",
  ...extra,
});

async function load(a: Arranged, handler: Handler, path: string, actor: Actor, params = {}) {
  return run(() =>
    handler(routeArgs(get(`/${a.slug}/${path}`, actor.cookie), { tenant: a.slug, ...params })),
  );
}

async function send(
  a: Arranged,
  handler: Handler,
  path: string,
  actor: Actor,
  body: FormBody = {},
  params = {},
) {
  const request = await post(`/${a.slug}/${path}`, actor.cookie, body);
  return run(() => handler(routeArgs(request, { tenant: a.slug, ...params })));
}

const structureCounts = async (a: Arranged) => ({
  organizations: await prisma.organization.count({
    where: { deletedAt: null },
  }),
  positions: await prisma.position.count({ where: { deletedAt: null } }),
  changes: await prisma.changeRequest.count({ where: { tenantId: a.tenantId } }),
});

describe.each(["focal", "manager"] as const)("a %s and the organogram and positions", (role) => {
  it("reads the lists and records, with nothing to edit, delete, move or add", async () => {
    const a = await arrange();
    const actor = a[role];
    const rights = { canWrite: false, canDelete: false, canSubmit: false };

    const pages: [Handler, string, Record<string, string>][] = [
      [organogramLoader as Handler, "organogram", {}],
      [organizationLoader as Handler, `organogram/${a.org.id}`, { orgId: a.org.id }],
      [positionsLoader as Handler, "positions", {}],
      [positionLoader as Handler, `positions/${a.position.id}`, { positionId: a.position.id }],
    ];
    for (const [handler, path, params] of pages) {
      const result = await load(a, handler, path, actor, params);
      expect(statusOf(result), path).toBe(200);
      expect(payloadOf(result), path).toMatchObject(rights);
    }

    const tree = await load(a, treeLoader as Handler, "organogram/tree", actor);
    expect(payloadOf(tree)).toMatchObject({ canMove: false, canCreate: false });

    // Assigning a person to a position is still theirs.
    const position = await load(a, positionLoader as Handler, `positions/${a.position.id}`, actor, {
      positionId: a.position.id,
    });
    expect(payloadOf(position)).toMatchObject({ canAssign: true });
  });

  it("is refused the new, edit and delete pages", async () => {
    const a = await arrange();
    const actor = a[role];
    const org = { orgId: a.org.id };
    const position = { positionId: a.position.id };

    const pages: [Handler, string, Record<string, string>][] = [
      [newOrganizationLoader as Handler, "organogram/new", {}],
      [editOrganizationLoader as Handler, `organogram/${a.org.id}/edit`, org],
      [deleteOrganizationLoader as Handler, `organogram/${a.org.id}/delete`, org],
      [newPositionLoader as Handler, "positions/new", {}],
      [editPositionLoader as Handler, `positions/${a.position.id}/edit`, position],
      [deletePositionLoader as Handler, `positions/${a.position.id}/delete`, position],
    ];
    for (const [handler, path, params] of pages) {
      expect(statusOf(await load(a, handler, path, actor, params)), path).toBe(403);
    }
  });

  it("is refused when posting a create, edit, move or delete directly", async () => {
    const a = await arrange();
    const actor = a[role];
    const before = await structureCounts(a);
    const org = { orgId: a.org.id };
    const position = { positionId: a.position.id };

    const posts: [Handler, string, FormBody, Record<string, string>][] = [
      [organizationEditorAction as Handler, "organogram/new", orgForm(a, "New Unit"), {}],
      [
        organizationEditorAction as Handler,
        `organogram/${a.org.id}/edit`,
        orgForm(a, "Renamed", { id: a.org.id }),
        org,
      ],
      [deleteOrganizationAction as Handler, `organogram/${a.org.id}/delete`, {}, org],
      [
        moveAction as Handler,
        "api/organizations/move",
        { intent: "move", organizationId: a.otherOrg.id, parentId: a.org.id },
        {},
      ],
      [positionEditorAction as Handler, "positions/new", positionForm(a, "Deputy"), {}],
      [
        positionEditorAction as Handler,
        `positions/${a.position.id}/edit`,
        positionForm(a, "Renamed", { id: a.position.id }),
        position,
      ],
      [deletePositionAction as Handler, `positions/${a.position.id}/delete`, {}, position],
    ];
    for (const [handler, path, body, params] of posts) {
      expect(statusOf(await send(a, handler, path, actor, body, params)), path).toBe(403);
    }

    expect(await structureCounts(a)).toEqual(before);
    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: a.otherOrg.id } });
    expect(stored.parentId).toBeNull();
  });

  it("still assigns a person to a position", async () => {
    const a = await arrange();
    const result = await send(
      a,
      assignAction as Handler,
      `positions/${a.position.id}/assign`,
      a[role],
      { positionId: a.position.id, personId: a.person.id, startDate: "2026-01-01" },
      { positionId: a.position.id },
    );
    expect(statusOf(result)).toBe(302);

    const change = await prisma.changeRequest.findFirstOrThrow({
      where: { tenantId: a.tenantId, entityType: "POSITION_ASSIGNMENT" },
    });
    expect(change.status).toBe(role === "manager" ? "APPROVED" : "DRAFT");
  });
});

describe("the global admin and the organogram and positions", () => {
  it("creates, edits, moves and deletes them, published at once", async () => {
    const a = await arrange();

    const created = await send(
      a,
      organizationEditorAction as Handler,
      "organogram/new",
      a.admin,
      orgForm(a, "New Unit"),
    );
    expect(statusOf(created)).toBe(302);
    const unit = await prisma.organization.findFirstOrThrow({ where: { name: "New Unit" } });

    const moved = await send(a, moveAction as Handler, "api/organizations/move", a.admin, {
      intent: "move",
      organizationId: unit.id,
      parentId: a.org.id,
    });
    expect(payloadOf(moved)).toMatchObject({ ok: true });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: unit.id } })).parentId).toBe(
      a.org.id,
    );

    const post = await send(
      a,
      positionEditorAction as Handler,
      "positions/new",
      a.admin,
      positionForm(a, "Deputy", { organizationId: unit.id }),
    );
    expect(statusOf(post)).toBe(302);
    const deputy = await prisma.position.findFirstOrThrow({ where: { title: "Deputy" } });

    const renamed = await send(
      a,
      positionEditorAction as Handler,
      `positions/${deputy.id}/edit`,
      a.admin,
      positionForm(a, "Deputy Director", { id: deputy.id, organizationId: unit.id }),
      { positionId: deputy.id },
    );
    expect(statusOf(renamed)).toBe(302);

    const removed = await send(
      a,
      deletePositionAction as Handler,
      `positions/${deputy.id}/delete`,
      a.admin,
      {},
      { positionId: deputy.id },
    );
    expect(statusOf(removed)).toBe(302);
    const stored = await prisma.position.findUniqueOrThrow({ where: { id: deputy.id } });
    expect(stored.title).toBe("Deputy Director");
    expect(stored.deletedAt).not.toBeNull();

    const changes = await prisma.changeRequest.findMany({ where: { tenantId: a.tenantId } });
    expect(changes).toHaveLength(5);
    expect(new Set(changes.map((c) => `${c.status}/${c.approvalMode}`))).toEqual(
      new Set(["APPROVED/SELF_APPROVED"]),
    );
  });
});

// One organogram and one set of positions for every tenant; the people
// holding the positions stay each tenant's own.
describe("the organogram and positions across tenants", () => {
  async function secondTenant(a: Arranged) {
    const tenant = await prisma.tenant.create({ data: buildTenant({ slug: "second" }) });
    await enableDirectory(prisma, tenant.id);
    const manager = await a.member("second-tenant-manager", a.managerRole.id, tenant.id);
    return { tenant, manager, slug: tenant.slug };
  }

  it("shows a tenant the units and positions made from another tenant", async () => {
    const a = await arrange();
    const b = await secondTenant(a);
    const args = (path: string, params = {}) =>
      routeArgs(get(`/${b.slug}/${path}`, b.manager.cookie), { tenant: b.slug, ...params });

    const units = payloadOf<{ organizations: { name: string }[] }>(
      await run(() => (organogramLoader as Handler)(args("organogram"))),
    );
    expect(units.organizations.map((o) => o.name).sort()).toEqual(["Registry", "Secretariat"]);

    const posts = payloadOf<{ positions: { title: string }[] }>(
      await run(() => (positionsLoader as Handler)(args("positions"))),
    );
    expect(posts.positions.map((p) => p.title)).toEqual(["Director"]);
  });

  it("shows a tenant its own people on a position, never another tenant's", async () => {
    const a = await arrange();
    const b = await secondTenant(a);
    await prisma.positionAssignment.create({
      data: {
        tenantId: a.tenantId,
        personId: a.person.id,
        positionId: a.position.id,
        startDate: new Date("2025-01-01"),
        isCurrent: true,
      },
    });
    type Detail = { position: { assignments: { person: { lastName: string } }[] } };
    type List = { positions: { _count: { assignments: number } }[] };
    const params = { positionId: a.position.id };

    const own = await load(
      a,
      positionLoader as Handler,
      `positions/${a.position.id}`,
      a.manager,
      params,
    );
    expect(payloadOf<Detail>(own).position.assignments.map((x) => x.person.lastName)).toEqual([
      "Diallo",
    ]);

    const other = await run(() =>
      (positionLoader as Handler)(
        routeArgs(get(`/${b.slug}/positions/${a.position.id}`, b.manager.cookie), {
          tenant: b.slug,
          ...params,
        }),
      ),
    );
    expect(payloadOf<Detail>(other).position.assignments).toEqual([]);

    const list = await run(() =>
      (positionsLoader as Handler)(
        routeArgs(get(`/${b.slug}/positions`, b.manager.cookie), { tenant: b.slug }),
      ),
    );
    expect(payloadOf<List>(list).positions.map((p) => p._count.assignments)).toEqual([0]);
  });
});

// Requests written before the rule: a focal person's draft, pending or
// rejected change to a unit or a post. They can be closed, never carried on.
describe("an organization or position change left over from before the rule", () => {
  const rename = (a: Arranged) =>
    saveDraft(
      {
        entityType: "ORGANIZATION",
        operation: "UPDATE",
        entityId: a.org.id,
        payload: { name: "Renamed", typeId: a.orgTypeId, isActive: true, sortOrder: 0 },
      },
      { userId: a.focal.id, tenantId: a.tenantId },
    );
  const newPost = (a: Arranged) =>
    saveDraft(
      {
        entityType: "POSITION",
        operation: "CREATE",
        payload: {
          organizationId: a.org.id,
          typeId: a.positionTypeId,
          title: "Deputy",
          isActive: true,
          sortOrder: 0,
        },
      },
      { userId: a.focal.id, tenantId: a.tenantId },
    );
  const focalCtx = (a: Arranged) => ({ userId: a.focal.id, tenantId: a.tenantId });
  const statusOfChange = async (id: string) =>
    (await prisma.changeRequest.findUniqueOrThrow({ where: { id } })).status;

  it("cannot be submitted by its author", async () => {
    const a = await arrange();
    const drafts = [await rename(a), await newPost(a)];

    const result = await send(
      a,
      submitDraftsAction as Handler,
      "submissions/submit-drafts",
      a.focal,
      { "ids[]": drafts.map((d) => d.id) },
    );

    const payload = payloadOf<{ result: { failed: { code: string; message: string }[] } }>(result);
    expect(payload.result.failed.map((f) => f.code)).toEqual(["ADMIN_MANAGED", "ADMIN_MANAGED"]);
    expect(payload.result.failed[0].message).toContain(ADMIN_MANAGED_EN);
    for (const draft of drafts) expect(await statusOfChange(draft.id)).toBe("DRAFT");
  });

  it("cannot be approved by a manager, alone or in a batch, but can be rejected", async () => {
    const a = await arrange();
    const drafts = [await rename(a), await newPost(a)];
    await submitDrafts(
      drafts.map((d) => d.id),
      focalCtx(a),
    );
    const [first, second] = drafts;

    const approved = await send(
      a,
      approveAction as Handler,
      `approvals/${first.id}/approve`,
      a.manager,
      {},
      { changeId: first.id },
    );
    expect(statusOf(approved)).toBe(409);
    expect(JSON.stringify(payloadOf(approved))).toContain(ADMIN_MANAGED_EN);

    const batch = await send(
      a,
      batchApproveAction as Handler,
      "approvals/batch-approve",
      a.manager,
      {
        "ids[]": drafts.map((d) => d.id),
      },
    );
    const payload = payloadOf<{ result: { failed: { code: string }[] } }>(batch);
    expect(payload.result.failed.map((f) => f.code)).toEqual(["ADMIN_MANAGED", "ADMIN_MANAGED"]);

    expect(await statusOfChange(first.id)).toBe("PENDING");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.org.id } })).name).toBe(
      "Secretariat",
    );
    expect(await prisma.position.count({ where: { title: "Deputy" } })).toBe(0);

    const rejected = await send(
      a,
      rejectAction as Handler,
      `approvals/${first.id}/reject`,
      a.manager,
      { notes: "Units are kept by the administrator" },
      { changeId: first.id },
    );
    expect(statusOf(rejected)).toBe(302);
    expect(await statusOfChange(first.id)).toBe("REJECTED");

    const withdrawn = await send(
      a,
      withdrawAction as Handler,
      `submissions/${second.id}/withdraw`,
      a.focal,
      {},
      { changeId: second.id },
    );
    expect(statusOf(withdrawn)).toBe(302);
    expect(await statusOfChange(second.id)).toBe("WITHDRAWN");
  });

  it("is approved by the global admin", async () => {
    const a = await arrange();
    const draft = await rename(a);
    await submitDrafts([draft.id], focalCtx(a));

    const approved = await send(
      a,
      approveAction as Handler,
      `approvals/${draft.id}/approve`,
      a.admin,
      {},
      { changeId: draft.id },
    );
    expect(statusOf(approved)).toBe(302);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.org.id } })).name).toBe(
      "Renamed",
    );
  });

  it("cannot be reopened once rejected", async () => {
    const a = await arrange();
    const draft = await rename(a);
    await submitDrafts([draft.id], focalCtx(a));
    await rejectChange(draft.id, { notes: "No" }, { userId: a.manager.id, tenantId: a.tenantId });

    const reopened = await send(
      a,
      reopenAction as Handler,
      `submissions/${draft.id}/reopen`,
      a.focal,
      {},
      { changeId: draft.id },
    );
    expect(statusOf(reopened)).toBe(409);
    expect(JSON.stringify(payloadOf(reopened))).toContain(ADMIN_MANAGED_EN);
    expect(await prisma.changeRequest.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });
});
