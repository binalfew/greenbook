import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as organizationEditorAction } from "~/routes/$tenant/directory/organizations/+shared/organization-editor.server";
import { loader as editOrganizationLoader } from "~/routes/$tenant/directory/organizations/$orgId_/edit";
import { loader as newOrganizationLoader } from "~/routes/$tenant/directory/organizations/new";
import { loader as changeDetailLoader } from "~/routes/$tenant/directory/approvals/$changeId._layout";
import { action as rejectAction } from "~/routes/$tenant/directory/approvals/$changeId.reject";
import { action as reopenAction } from "~/routes/$tenant/directory/approvals/$changeId.reopen";
import { action as batchApproveAction } from "~/routes/$tenant/directory/approvals/batch-approve";
import { loader as historyLoader } from "~/routes/$tenant/directory/approvals/history";
import { loader as approvalQueueLoader } from "~/routes/$tenant/directory/approvals/index";
import { action as submitDraftsAction } from "~/routes/$tenant/directory/approvals/submit-drafts";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

// A rejected request can be reopened by its author as a new draft, corrected
// and sent back through the draft flow (#26). Driven through the route
// loaders and actions, the way the browser drives them.

beforeEach(() => {
  clearFlagCache();
});

type Seeded = {
  tenantId: string;
  slug: string;
  focal: { id: string; cookie: string };
  otherFocal: { id: string; cookie: string };
  manager: { id: string; cookie: string };
  orgTypeId: string;
};

async function arrange(): Promise<Seeded> {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("test-password", 4);

  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });

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
  await grant(focalRole.id, "directory-change", "read-own");
  await grant(focalRole.id, "directory-change", "withdraw-own");

  await grant(managerRole.id, "organization", "read");
  await grant(managerRole.id, "organization", "write");
  await grant(managerRole.id, "organization", "delete");
  await grant(managerRole.id, "directory-change", "approve");
  await grant(managerRole.id, "directory-change", "reject");
  await grant(managerRole.id, "directory-change", "read-all");

  async function user(name: string, roleId: string) {
    const created = await prisma.user.create({
      data: {
        email: `${name}-${tenant.id}@test.com`,
        firstName: name,
        lastName: "Tester",
        tenantId: tenant.id,
        userStatusId: status.id,
        password: { create: { hash: passwordHash } },
        userRoles: { create: { roleId } },
      },
    });
    return { id: created.id, cookie: await createSessionCookie(prisma, created.id) };
  }

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
    focal: await user("focal", focalRole.id),
    otherFocal: await user("other-focal", focalRole.id),
    manager: await user("manager", managerRole.id),
    orgTypeId: orgType.id,
  };
}

function get(a: Seeded, cookie: string, path: string): Request {
  return new Request(`http://localhost/${a.slug}/directory/${path}`, { headers: { cookie } });
}

function post(
  a: Seeded,
  cookie: string,
  path: string,
  body: Record<string, string | string[]> = {},
): Request {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    for (const item of Array.isArray(v) ? v : [v]) form.append(k, item);
  }
  return new Request(`http://localhost/${a.slug}/directory/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: form.toString(),
  });
}

/** Loaders/actions either return or throw a Response / data() wrapper. */
async function run<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

function statusOf(result: unknown): number | undefined {
  if (result instanceof Response) return result.status;
  const init = (result as { init?: { status?: number } | null } | null)?.init;
  return init?.status;
}

function payloadOf<T>(result: unknown): T {
  return (result as { data: T }).data;
}

function locationOf(result: unknown): string | null {
  return result instanceof Response ? result.headers.get("location") : null;
}

function orgForm(a: Seeded, name: string, extra: Record<string, string> = {}) {
  return { name, typeId: a.orgTypeId, isActive: "true", sortOrder: "0", ...extra };
}

/** Save a CREATE-organization draft as the given user; returns the draft row. */
async function saveOrgDraft(a: Seeded, cookie: string, name: string) {
  const response = await run(() =>
    organizationEditorAction({
      request: post(a, cookie, "organizations/new", orgForm(a, name)),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  expect(statusOf(response)).toBe(302);
  const drafts = await draftsOf(a);
  const draft = drafts.find((d) => (d.payload as { name?: string }).name === name);
  expect(draft).toBeTruthy();
  return draft!;
}

/** Save an UPDATE (a rename) of a published organization: a draft for a focal person. */
async function saveRename(
  a: Seeded,
  cookie: string,
  org: { id: string; version: number },
  name: string,
) {
  return run(() =>
    organizationEditorAction({
      request: post(
        a,
        cookie,
        `organizations/${org.id}/edit`,
        orgForm(a, name, { id: org.id, baseVersion: String(org.version) }),
      ),
      params: { tenant: a.slug, orgId: org.id },
      context: {},
    }),
  );
}

async function submitDrafts(a: Seeded, cookie: string, ids: string[]) {
  const result = await run(() =>
    submitDraftsAction({
      request: post(a, cookie, "approvals/submit-drafts", { "ids[]": ids }),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  return payloadOf<{ result: { succeeded: { id: string }[] } }>(result);
}

async function queueIds(a: Seeded, cookie: string) {
  const result = await approvalQueueLoader({
    request: get(a, cookie, "approvals"),
    params: { tenant: a.slug },
    context: {},
  } as never);
  return payloadOf<{ changes: { id: string }[] }>(result).changes.map((c) => c.id);
}

async function publishedOrg(a: Seeded, cookie: string, name: string) {
  await run(() =>
    organizationEditorAction({
      request: post(a, cookie, "organizations/new", orgForm(a, name)),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  return prisma.organization.findFirstOrThrow({ where: { tenantId: a.tenantId, name } });
}

async function draftsOf(a: Seeded) {
  return prisma.changeRequest.findMany({ where: { tenantId: a.tenantId, status: "DRAFT" } });
}

const NOTES = "The acronym is missing. Please add it.";

async function reject(a: Seeded, id: string) {
  const response = await run(() =>
    rejectAction({
      request: post(a, a.manager.cookie, `approvals/${id}/reject`, { notes: NOTES }),
      params: { tenant: a.slug, changeId: id },
      context: {},
    } as never),
  );
  expect(statusOf(response)).toBe(302);
}

/** focal saves a CREATE draft, submits it, the manager rejects it. */
async function rejectedCreate(a: Seeded, name: string) {
  const draft = await saveOrgDraft(a, a.focal.cookie, name);
  await submitDrafts(a, a.focal.cookie, [draft.id]);
  await reject(a, draft.id);
  return draft.id;
}

/** focal drafts a rename of a published org, submits it, the manager rejects it. */
async function rejectedRename(a: Seeded, org: { id: string; version: number }, name: string) {
  await saveRename(a, a.focal.cookie, org, name);
  const draft = await prisma.changeRequest.findFirstOrThrow({
    where: { tenantId: a.tenantId, status: "DRAFT", entityId: org.id },
  });
  await submitDrafts(a, a.focal.cookie, [draft.id]);
  await reject(a, draft.id);
  return draft.id;
}

function reopen(a: Seeded, cookie: string, id: string) {
  return run(() =>
    reopenAction({
      request: post(a, cookie, `approvals/${id}/reopen`),
      params: { tenant: a.slug, changeId: id },
      context: {},
    } as never),
  );
}

type DetailData = {
  change: { id: string; status: string };
  canReopen: boolean;
  reopenedFrom: { changeId: string; notes: string | null; reviewerName: string | null } | null;
};

async function detail(a: Seeded, cookie: string, id: string) {
  const result = await changeDetailLoader({
    request: get(a, cookie, `approvals/${id}`),
    params: { tenant: a.slug, changeId: id },
    context: {},
  } as never);
  return payloadOf<DetailData>(result);
}

describe("reopening a rejected request", () => {
  it("the author reopens it as a draft pre-filled with the rejected values, with the rejection notes", async () => {
    const a = await arrange();
    const rejectedId = await rejectedCreate(a, "Bureau of Statistics");

    expect((await detail(a, a.focal.cookie, rejectedId)).canReopen).toBe(true);

    const response = await reopen(a, a.focal.cookie, rejectedId);
    expect(statusOf(response)).toBe(302);

    const drafts = await draftsOf(a);
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft.id).not.toBe(rejectedId);
    expect(draft.submittedById).toBe(a.focal.id);
    expect(locationOf(response)).toBe(`/${a.slug}/directory/organizations/new?draft=${draft.id}`);

    // The editor resumes the draft with the submitted values and shows why
    // the earlier request was rejected.
    const loaded = await newOrganizationLoader({
      request: get(a, a.focal.cookie, `organizations/new?draft=${draft.id}`),
      params: { tenant: a.slug },
      context: {},
    } as never);
    const editor = payloadOf<{
      draft: {
        id: string;
        values: { name: string; typeId: string };
        rejection: { changeId: string; notes: string; reviewerName: string } | null;
      };
    }>(loaded).draft;
    expect(editor.values).toMatchObject({ name: "Bureau of Statistics", typeId: a.orgTypeId });
    expect(editor.rejection).toMatchObject({
      changeId: rejectedId,
      notes: NOTES,
      reviewerName: "manager Tester",
    });

    // The rejected request itself is untouched.
    const rejected = await prisma.changeRequest.findUniqueOrThrow({ where: { id: rejectedId } });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reviewerNotes).toBe(NOTES);
    expect((rejected.payload as { name: string }).name).toBe("Bureau of Statistics");
  });

  it("an ordinary draft carries no rejection notes", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Plain Draft");
    const loaded = await newOrganizationLoader({
      request: get(a, a.focal.cookie, `organizations/new?draft=${draft.id}`),
      params: { tenant: a.slug },
      context: {},
    } as never);
    expect(payloadOf<{ draft: { rejection: unknown } }>(loaded).draft.rejection).toBeNull();
  });

  it("reopen → edit → resubmit → approve publishes the corrected record and keeps the rejection in history", async () => {
    const a = await arrange();
    const rejectedId = await rejectedCreate(a, "Bureau of Statistics");
    await reopen(a, a.focal.cookie, rejectedId);
    const [draft] = await draftsOf(a);

    // Not in the manager's queue until it is resubmitted.
    expect(await queueIds(a, a.manager.cookie)).toEqual([]);

    const saved = await run(() =>
      organizationEditorAction({
        request: post(
          a,
          a.focal.cookie,
          `organizations/new?draft=${draft.id}`,
          orgForm(a, "Bureau of Statistics", { acronym: "BOS" }),
        ),
        params: { tenant: a.slug },
        context: {},
      }),
    );
    expect(statusOf(saved)).toBe(302);

    const { result } = await submitDrafts(a, a.focal.cookie, [draft.id]);
    expect(result.succeeded.map((s) => s.id)).toEqual([draft.id]);
    expect(await queueIds(a, a.manager.cookie)).toEqual([draft.id]);

    // The manager sees that this submission follows a rejection.
    const seen = await detail(a, a.manager.cookie, draft.id);
    expect(seen.change.status).toBe("PENDING");
    expect(seen.reopenedFrom).toEqual({
      changeId: rejectedId,
      notes: NOTES,
      reviewerName: "manager Tester",
    });

    const approved = await batchApproveAction({
      request: post(a, a.manager.cookie, "approvals/batch-approve", { "ids[]": [draft.id] }),
      params: { tenant: a.slug },
      context: {},
    });
    expect(payloadOf<{ result: { succeeded: unknown[] } }>(approved).result.succeeded).toHaveLength(
      1,
    );

    const orgs = await prisma.organization.findMany({ where: { tenantId: a.tenantId } });
    expect(orgs.map((o) => [o.name, o.acronym])).toEqual([["Bureau of Statistics", "BOS"]]);

    const history = await historyLoader({
      request: get(a, a.manager.cookie, "approvals/history"),
      params: { tenant: a.slug },
      context: {},
    } as never);
    const rows = payloadOf<{ changes: { id: string; status: string }[] }>(history).changes;
    expect(rows.map((r) => `${r.id}:${r.status}`).sort()).toEqual(
      [`${rejectedId}:REJECTED`, `${draft.id}:APPROVED`].sort(),
    );
  });

  it("only the author can reopen their rejected request", async () => {
    const a = await arrange();
    const rejectedId = await rejectedCreate(a, "Bureau of Statistics");

    expect(statusOf(await reopen(a, a.otherFocal.cookie, rejectedId))).toBe(403);
    expect(statusOf(await reopen(a, a.manager.cookie, rejectedId))).toBe(403);
    expect(await draftsOf(a)).toEqual([]);

    expect((await detail(a, a.manager.cookie, rejectedId)).canReopen).toBe(false);
  });

  it("a request that was not rejected cannot be reopened", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Still Pending");
    await submitDrafts(a, a.focal.cookie, [draft.id]);

    expect((await detail(a, a.focal.cookie, draft.id)).canReopen).toBe(false);
    const response = await reopen(a, a.focal.cookie, draft.id);
    expect(statusOf(response)).toBe(409);
    expect(payloadOf<{ error: string }>(response).error).toMatch(/only a rejected request/i);
    expect(await draftsOf(a)).toEqual([]);
  });

  it("an unknown request is not found", async () => {
    const a = await arrange();
    expect(statusOf(await reopen(a, a.focal.cookie, "missing"))).toBe(404);
  });

  it("a reopened update resumes in the record's edit page", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Version One");
    const rejectedId = await rejectedRename(a, org, "Focal Rename");

    const response = await reopen(a, a.focal.cookie, rejectedId);
    const [draft] = await draftsOf(a);
    expect(locationOf(response)).toBe(
      `/${a.slug}/directory/organizations/${org.id}/edit?draft=${draft.id}`,
    );

    const loaded = await editOrganizationLoader({
      request: get(a, a.focal.cookie, `organizations/${org.id}/edit?draft=${draft.id}`),
      params: { tenant: a.slug, orgId: org.id },
      context: {},
    } as never);
    const editor = payloadOf<{
      draft: { values: { name: string }; rejection: { notes: string } | null };
    }>(loaded).draft;
    expect(editor.values.name).toBe("Focal Rename");
    expect(editor.rejection?.notes).toBe(NOTES);
  });
});

describe("reopening is refused with a clear message", () => {
  it("when the record has changed since the request was made", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Version One");
    const rejectedId = await rejectedRename(a, org, "Focal Rename");

    await saveRename(a, a.manager.cookie, org, "Manager Rename");

    const response = await reopen(a, a.focal.cookie, rejectedId);
    expect(statusOf(response)).toBe(409);
    expect(payloadOf<{ error: string }>(response).error).toMatch(/has changed since/i);
    expect(await draftsOf(a)).toEqual([]);
  });

  it("when the record has been deleted since", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Version One");
    const rejectedId = await rejectedRename(a, org, "Focal Rename");
    await prisma.organization.update({ where: { id: org.id }, data: { deletedAt: new Date() } });

    const response = await reopen(a, a.focal.cookie, rejectedId);
    expect(statusOf(response)).toBe(409);
    expect(payloadOf<{ error: string }>(response).error).toMatch(/has changed since/i);
    expect(await draftsOf(a)).toEqual([]);
  });

  it("when the record already has a change waiting for review", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Version One");
    const rejectedId = await rejectedRename(a, org, "Focal Rename");

    await saveRename(a, a.otherFocal.cookie, org, "Other Rename");
    const other = await prisma.changeRequest.findFirstOrThrow({
      where: { tenantId: a.tenantId, status: "DRAFT", submittedById: a.otherFocal.id },
    });
    await submitDrafts(a, a.otherFocal.cookie, [other.id]);

    const response = await reopen(a, a.focal.cookie, rejectedId);
    expect(statusOf(response)).toBe(409);
    expect(payloadOf<{ error: string }>(response).error).toMatch(/waiting for review/i);
    expect(await draftsOf(a)).toEqual([]);
  });

  it("when the author already has a draft for the record", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Version One");
    const rejectedId = await rejectedRename(a, org, "Focal Rename");
    await saveRename(a, a.focal.cookie, org, "Second Attempt");

    const response = await reopen(a, a.focal.cookie, rejectedId);
    expect(statusOf(response)).toBe(409);
    expect(payloadOf<{ error: string }>(response).error).toMatch(/already have a draft/i);
    expect(await draftsOf(a)).toHaveLength(1);
  });

  it("when it has already been reopened", async () => {
    const a = await arrange();
    const rejectedId = await rejectedCreate(a, "Bureau of Statistics");
    expect(statusOf(await reopen(a, a.focal.cookie, rejectedId))).toBe(302);

    const again = await reopen(a, a.focal.cookie, rejectedId);
    expect(statusOf(again)).toBe(409);
    expect(payloadOf<{ error: string }>(again).error).toMatch(/already been reopened/i);
    expect(await draftsOf(a)).toHaveLength(1);
    expect((await detail(a, a.focal.cookie, rejectedId)).canReopen).toBe(false);
  });
});
