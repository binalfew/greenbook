import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as organizationEditorAction } from "~/routes/$tenant/_directory/organogram/+shared/organization-editor.server";
import { loader as editOrganizationLoader } from "~/routes/$tenant/_directory/organogram/$orgId_/edit";
import { loader as newOrganizationLoader } from "~/routes/$tenant/_directory/organogram/new";
import { action as deleteOrganizationAction } from "~/routes/$tenant/_directory/organogram/$orgId.delete";
import { loader as changeDetailLoader } from "~/routes/$tenant/_directory/approvals/$changeId._layout";
import { action as discardAction } from "~/routes/$tenant/_directory/approvals/$changeId.discard";
import { action as batchApproveAction } from "~/routes/$tenant/_directory/approvals/batch-approve";
import { loader as approvalQueueLoader } from "~/routes/$tenant/_directory/approvals/index";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/approvals/submit-drafts";
import { loader as submissionsLoader } from "~/routes/$tenant/_directory/submissions";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import { createSessionCookie } from "./helpers/session";

// Domain events leave the process (outbound integrations); spy on that
// boundary so "entity events fire only on approval" is observable.
vi.mock("~/utils/events/emit-domain-event.server", () => ({ emitDomainEvent: vi.fn() }));

beforeEach(() => {
  clearFlagCache();
  vi.mocked(emitDomainEvent).mockClear();
});

type Seeded = {
  tenantId: string;
  slug: string;
  focal: { id: string; cookie: string };
  otherFocal: { id: string; cookie: string };
  manager: { id: string; cookie: string };
  secondManager: { id: string; cookie: string };
  orgTypeId: string;
};

async function arrange(): Promise<Seeded> {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("test-password", 4);

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
    secondManager: await user("second-manager", managerRole.id),
    orgTypeId: orgType.id,
  };
}

function get(a: Seeded, cookie: string, path: string): Request {
  return new Request(`http://localhost/${a.slug}/${path}`, { headers: { cookie } });
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
  return new Request(`http://localhost/${a.slug}/${path}`, {
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

function orgForm(a: Seeded, name: string, extra: Record<string, string> = {}) {
  return { name, typeId: a.orgTypeId, isActive: "true", sortOrder: "0", ...extra };
}

/** Save a CREATE-organization draft as the given user; returns the draft row. */
async function saveOrgDraft(a: Seeded, cookie: string, name: string) {
  const response = await run(() =>
    organizationEditorAction({
      request: post(a, cookie, "organogram/new", orgForm(a, name)),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  expect(statusOf(response)).toBe(302);
  const drafts = await prisma.changeRequest.findMany({
    where: { tenantId: a.tenantId, status: "DRAFT" },
  });
  const draft = drafts.find((d) => (d.payload as { name?: string }).name === name);
  expect(draft).toBeTruthy();
  return draft!;
}

/** Save an UPDATE draft (a rename) of a published organization. */
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
        `organogram/${org.id}/edit`,
        orgForm(a, name, { id: org.id, baseVersion: String(org.version) }),
      ),
      params: { tenant: a.slug, orgId: org.id },
      context: {},
    }),
  );
}

type SubmitResponse = {
  result: {
    succeeded: { id: string }[];
    failed: { id: string; code: string }[];
    skipped: { id: string; reason: string }[];
  };
};

async function submitDrafts(a: Seeded, cookie: string, ids: string[]) {
  const result = await run(() =>
    submitDraftsAction({
      request: post(a, cookie, "approvals/submit-drafts", { "ids[]": ids }),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  return payloadOf<SubmitResponse>(result);
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
      request: post(a, cookie, "organogram/new", orgForm(a, name)),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  return prisma.organization.findFirstOrThrow({ where: { tenantId: a.tenantId, name } });
}

describe("drafts: saving", () => {
  it("a focal person's save creates a draft that the manager's queue does not show", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Draft Org");

    expect(draft.status).toBe("DRAFT");
    expect(draft.submittedById).toBe(a.focal.id);
    expect(await prisma.organization.count({ where: { tenantId: a.tenantId } })).toBe(0);
    expect(await queueIds(a, a.manager.cookie)).toEqual([]);
    expect(await prisma.notification.count({ where: { tenantId: a.tenantId } })).toBe(0);
    expect(emitDomainEvent).not.toHaveBeenCalled();
  });

  it("a manager's direct edit still applies immediately", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Direct Org");

    expect(org.deletedAt).toBeNull();
    expect(await prisma.changeRequest.count({ where: { status: "DRAFT" } })).toBe(0);
  });

  it("the author sees the draft in their own list and on its detail page", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Mine");

    const list = await submissionsLoader({
      request: get(a, a.focal.cookie, "submissions?status=DRAFT"),
      params: { tenant: a.slug },
      context: {},
    } as never);
    expect(payloadOf<{ changes: { id: string }[] }>(list).changes.map((c) => c.id)).toEqual([
      draft.id,
    ]);

    const detail = await changeDetailLoader({
      request: get(a, a.focal.cookie, `approvals/${draft.id}`),
      params: { tenant: a.slug, changeId: draft.id },
      context: {},
    } as never);
    expect(payloadOf<{ change: { status: string } }>(detail).change.status).toBe("DRAFT");
  });

  it("nobody else can see a draft — not a manager, not another focal person", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Private");

    for (const cookie of [a.manager.cookie, a.otherFocal.cookie]) {
      const detail = await run(() =>
        changeDetailLoader({
          request: get(a, cookie, `approvals/${draft.id}`),
          params: { tenant: a.slug, changeId: draft.id },
          context: {},
        } as never),
      );
      expect(statusOf(detail)).toBe(404);
    }

    const otherList = await submissionsLoader({
      request: get(a, a.otherFocal.cookie, "submissions"),
      params: { tenant: a.slug },
      context: {},
    } as never);
    expect(payloadOf<{ changes: unknown[] }>(otherList).changes).toEqual([]);
  });
});

describe("drafts: editing and discarding", () => {
  it("re-saving through the editor with ?draft= updates the same draft", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "First Name");

    const loaded = await newOrganizationLoader({
      request: get(a, a.focal.cookie, `organogram/new?draft=${draft.id}`),
      params: { tenant: a.slug },
      context: {},
    } as never);
    expect(
      payloadOf<{ draft: { id: string; values: { name: string } } }>(loaded).draft,
    ).toMatchObject({ id: draft.id, values: { name: "First Name" } });

    const response = await run(() =>
      organizationEditorAction({
        request: post(
          a,
          a.focal.cookie,
          `organogram/new?draft=${draft.id}`,
          orgForm(a, "Second Name"),
        ),
        params: { tenant: a.slug },
        context: {},
      }),
    );
    expect(statusOf(response)).toBe(302);

    const rows = await prisma.changeRequest.findMany({ where: { tenantId: a.tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(draft.id);
    expect(rows[0].status).toBe("DRAFT");
    expect((rows[0].payload as { name: string }).name).toBe("Second Name");
  });

  it("another user cannot overwrite the author's draft", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Original");

    const response = await run(() =>
      organizationEditorAction({
        request: post(
          a,
          a.otherFocal.cookie,
          `organogram/new?draft=${draft.id}`,
          orgForm(a, "Hijacked"),
        ),
        params: { tenant: a.slug },
        context: {},
      }),
    ).catch((err) => err);

    expect(response).toMatchObject({ code: "NOT_FOUND", status: 404 });
    const rows = await prisma.changeRequest.findMany({ where: { tenantId: a.tenantId } });
    expect(rows.map((r) => (r.payload as { name: string }).name)).toEqual(["Original"]);
    expect(rows[0].id).toBe(draft.id);
  });

  it("opening the edit page of a record with an own draft resumes that draft", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Published");

    await saveRename(a, a.focal.cookie, org, "Renamed In Draft");
    const draft = await prisma.changeRequest.findFirstOrThrow({
      where: { tenantId: a.tenantId, status: "DRAFT", entityId: org.id },
    });

    const bare = await run(() =>
      editOrganizationLoader({
        request: get(a, a.focal.cookie, `organogram/${org.id}/edit`),
        params: { tenant: a.slug, orgId: org.id },
        context: {},
      } as never),
    );
    expect(statusOf(bare)).toBe(302);
    expect((bare as Response).headers.get("location")).toBe(
      `/${a.slug}/organogram/${org.id}/edit?draft=${draft.id}`,
    );

    const resumed = await editOrganizationLoader({
      request: get(a, a.focal.cookie, `organogram/${org.id}/edit?draft=${draft.id}`),
      params: { tenant: a.slug, orgId: org.id },
      context: {},
    } as never);
    expect(
      payloadOf<{ draft: { values: { name: string; baseVersion: number } } }>(resumed).draft.values,
    ).toMatchObject({ name: "Renamed In Draft", baseVersion: org.version });

    // The published record is untouched until a manager approves.
    const live = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(live.name).toBe("Published");
  });

  it("the author can discard a draft; nobody else can", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Mistake");

    const denied = await run(() =>
      discardAction({
        request: post(a, a.otherFocal.cookie, `approvals/${draft.id}/discard`),
        params: { tenant: a.slug, changeId: draft.id },
        context: {},
      } as never),
    );
    expect(statusOf(denied)).toBe(404);
    expect(await prisma.changeRequest.count({ where: { id: draft.id } })).toBe(1);

    const ok = await run(() =>
      discardAction({
        request: post(a, a.focal.cookie, `approvals/${draft.id}/discard`),
        params: { tenant: a.slug, changeId: draft.id },
        context: {},
      } as never),
    );
    expect(statusOf(ok)).toBe(302);
    expect(await prisma.changeRequest.count({ where: { id: draft.id } })).toBe(0);
  });

  it("a submitted request can no longer be discarded", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Sent");
    await submitDrafts(a, a.focal.cookie, [draft.id]);

    const response = await run(() =>
      discardAction({
        request: post(a, a.focal.cookie, `approvals/${draft.id}/discard`),
        params: { tenant: a.slug, changeId: draft.id },
        context: {},
      } as never),
    );
    expect(statusOf(response)).toBe(404);
    expect(await prisma.changeRequest.count({ where: { id: draft.id } })).toBe(1);
  });
});

describe("drafts: submitting", () => {
  it("submits several drafts together with one notification per approver", async () => {
    const a = await arrange();
    const one = await saveOrgDraft(a, a.focal.cookie, "Org One");
    const two = await saveOrgDraft(a, a.focal.cookie, "Org Two");
    const three = await saveOrgDraft(a, a.focal.cookie, "Org Three");

    const { result } = await submitDrafts(a, a.focal.cookie, [one.id, two.id, three.id]);

    expect(result.succeeded.map((s) => s.id)).toEqual([one.id, two.id, three.id]);
    expect((await queueIds(a, a.manager.cookie)).sort()).toEqual([one.id, two.id, three.id].sort());

    const notifications = await prisma.notification.findMany({
      where: { tenantId: a.tenantId },
    });
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [a.manager.id, a.secondManager.id].sort(),
    );
    expect(notifications.every((n) => n.type === "directory.change.submitted")).toBe(true);
  });

  it("submits a single draft", async () => {
    const a = await arrange();
    const keep = await saveOrgDraft(a, a.focal.cookie, "Not Yet");
    const urgent = await saveOrgDraft(a, a.focal.cookie, "Urgent");

    const { result } = await submitDrafts(a, a.focal.cookie, [urgent.id]);

    expect(result.succeeded.map((s) => s.id)).toEqual([urgent.id]);
    expect(await queueIds(a, a.manager.cookie)).toEqual([urgent.id]);
    const kept = await prisma.changeRequest.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept.status).toBe("DRAFT");
    expect(
      await prisma.notification.count({ where: { tenantId: a.tenantId, userId: a.manager.id } }),
    ).toBe(1);
  });

  it("skips ids that are not the caller's drafts", async () => {
    const a = await arrange();
    const mine = await saveOrgDraft(a, a.focal.cookie, "Mine");
    const theirs = await saveOrgDraft(a, a.otherFocal.cookie, "Theirs");
    const already = await saveOrgDraft(a, a.focal.cookie, "Already");
    await submitDrafts(a, a.focal.cookie, [already.id]);

    const { result } = await submitDrafts(a, a.focal.cookie, [
      mine.id,
      theirs.id,
      already.id,
      "does-not-exist",
    ]);

    expect(result.succeeded.map((s) => s.id)).toEqual([mine.id]);
    expect(result.skipped).toEqual([
      { id: theirs.id, reason: "NOT_FOUND" },
      { id: already.id, reason: "NOT_DRAFT" },
      { id: "does-not-exist", reason: "NOT_FOUND" },
    ]);
    const untouched = await prisma.changeRequest.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched.status).toBe("DRAFT");
  });

  it("refuses an empty selection and one over the batch cap", async () => {
    const a = await arrange();

    const empty = await run(() =>
      submitDraftsAction({
        request: post(a, a.focal.cookie, "approvals/submit-drafts"),
        params: { tenant: a.slug },
        context: {},
      }),
    );
    expect(statusOf(empty)).toBe(400);

    const tooMany = await run(() =>
      submitDraftsAction({
        request: post(a, a.focal.cookie, "approvals/submit-drafts", {
          "ids[]": Array.from({ length: 101 }, (_, i) => `id-${i}`),
        }),
        params: { tenant: a.slug },
        context: {},
      }),
    );
    expect(statusOf(tooMany)).toBe(400);
  });

  it("a manager without the submit permission cannot use the submit route", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Guarded");

    const response = await run(() =>
      submitDraftsAction({
        request: post(a, a.manager.cookie, "approvals/submit-drafts", { "ids[]": [draft.id] }),
        params: { tenant: a.slug },
        context: {},
      }),
    );
    expect(statusOf(response)).toBe(403);
  });

  it("reports a stale edit at submit and leaves the draft a draft", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Version One");

    await saveRename(a, a.focal.cookie, org, "Focal Rename");
    const draft = await prisma.changeRequest.findFirstOrThrow({
      where: { tenantId: a.tenantId, status: "DRAFT" },
    });

    // A manager changes the record after the draft was started — the draft
    // does not block them.
    await saveRename(a, a.manager.cookie, org, "Manager Rename");
    const live = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(live.name).toBe("Manager Rename");

    const { result } = await submitDrafts(a, a.focal.cookie, [draft.id]);

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toMatchObject([{ id: draft.id, code: "VERSION_CONFLICT" }]);
    const row = await prisma.changeRequest.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe("DRAFT");
    expect(await prisma.notification.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it("allows one open change per record: the second submit fails, the first stands", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Contested");

    // Two focal persons may each hold a draft on the same record…
    await saveRename(a, a.focal.cookie, org, "First Proposal");
    await saveRename(a, a.otherFocal.cookie, org, "Second Proposal");
    const [first, second] = await Promise.all(
      [a.focal.id, a.otherFocal.id].map((submittedById) =>
        prisma.changeRequest.findFirstOrThrow({
          where: { tenantId: a.tenantId, status: "DRAFT", submittedById },
        }),
      ),
    );

    // …but only one of them can be pending at a time.
    const won = await submitDrafts(a, a.focal.cookie, [first.id]);
    expect(won.result.succeeded.map((s) => s.id)).toEqual([first.id]);

    const lost = await submitDrafts(a, a.otherFocal.cookie, [second.id]);
    expect(lost.result.failed).toMatchObject([{ id: second.id, code: "PENDING_REQUEST_EXISTS" }]);
    const row = await prisma.changeRequest.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.status).toBe("DRAFT");
  });

  it("refuses the author's own second draft on the same record", async () => {
    const a = await arrange();
    const org = await publishedOrg(a, a.manager.cookie, "Twice");
    await saveRename(a, a.focal.cookie, org, "Edit Draft");

    const second = await run(() =>
      deleteOrganizationAction({
        request: post(a, a.focal.cookie, `organogram/${org.id}/delete`, { reason: "dup" }),
        params: { tenant: a.slug, orgId: org.id },
        context: {},
      } as never),
    );

    // An ordinary conflict: a message on the dialog, not a server error.
    expect(second).toMatchObject({
      init: { status: 409 },
      data: {
        formError:
          "You already have a draft for this record. Edit, submit or discard that draft first.",
      },
    });
    expect(
      await prisma.changeRequest.count({ where: { tenantId: a.tenantId, status: "DRAFT" } }),
    ).toBe(1);
  });
});

describe("drafts: through to approval", () => {
  it("draft → bulk submit → batch approve publishes the records; entity events fire only then", async () => {
    const a = await arrange();
    const one = await saveOrgDraft(a, a.focal.cookie, "Alpha");
    const two = await saveOrgDraft(a, a.focal.cookie, "Beta");

    const eventNames = () => vi.mocked(emitDomainEvent).mock.calls.map((call) => call[1]);
    expect(eventNames()).toEqual([]);

    await submitDrafts(a, a.focal.cookie, [one.id, two.id]);
    expect(eventNames()).toEqual(["change.submitted", "change.submitted"]);
    expect(await prisma.organization.count({ where: { tenantId: a.tenantId } })).toBe(0);

    const approved = await batchApproveAction({
      request: post(a, a.manager.cookie, "approvals/batch-approve", { "ids[]": [one.id, two.id] }),
      params: { tenant: a.slug },
      context: {},
    });
    expect(payloadOf<{ result: { succeeded: unknown[] } }>(approved).result.succeeded).toHaveLength(
      2,
    );

    const orgs = await prisma.organization.findMany({
      where: { tenantId: a.tenantId, deletedAt: null },
      orderBy: { name: "asc" },
    });
    expect(orgs.map((o) => o.name)).toEqual(["Alpha", "Beta"]);
    expect(eventNames().filter((name) => name === "organization.created")).toHaveLength(2);
  });

  it("a manager cannot approve a draft that was never submitted", async () => {
    const a = await arrange();
    const draft = await saveOrgDraft(a, a.focal.cookie, "Unsubmitted");

    const approved = await batchApproveAction({
      request: post(a, a.manager.cookie, "approvals/batch-approve", { "ids[]": [draft.id] }),
      params: { tenant: a.slug },
      context: {},
    });

    expect(payloadOf<{ result: { skipped: unknown[] } }>(approved).result.skipped).toEqual([
      { id: draft.id, reason: "NOT_FOUND" },
    ]);
    expect(await prisma.organization.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });
});
