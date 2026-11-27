import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as organizationEditorAction } from "~/routes/$tenant/directory/organizations/+shared/organization-editor.server";
import { action as deleteOrganizationAction } from "~/routes/$tenant/directory/organizations/$orgId.delete";
import { action as submitDraftsAction } from "~/routes/$tenant/directory/approvals/submit-drafts";
import { loader as submissionsLoader } from "~/routes/$tenant/directory/submissions";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import { createSessionCookie } from "./helpers/session";

// Domain events leave the process (outbound integrations); keep them inside the test.
vi.mock("~/utils/events/emit-domain-event.server", () => ({ emitDomainEvent: vi.fn() }));

beforeEach(() => {
  clearFlagCache();
  vi.mocked(emitDomainEvent).mockClear();
});

type Seeded = {
  tenantId: string;
  slug: string;
  focal: { id: string; cookie: string };
  manager: { id: string; cookie: string };
  orgTypeId: string;
};

async function arrange(): Promise<Seeded> {
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
  await grant(focalRole.id, "directory-change", "read-own");
  await grant(focalRole.id, "directory-change", "withdraw-own");

  await grant(managerRole.id, "organization", "read");
  await grant(managerRole.id, "organization", "write");
  await grant(managerRole.id, "organization", "delete");
  // As seeded: a manager holds everything a focal person does.
  await grant(managerRole.id, "directory-change", "submit");
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
    focal: await user("focal", focalRole.id),
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

function orgForm(a: Seeded, name: string, extra: Record<string, string> = {}) {
  return { name, typeId: a.orgTypeId, isActive: "true", sortOrder: "0", ...extra };
}

/** Save a new organization through the editor as the given user. */
function saveNewOrg(a: Seeded, cookie: string, name: string) {
  return run(() =>
    organizationEditorAction({
      request: post(a, cookie, "organizations/new", orgForm(a, name)),
      params: { tenant: a.slug },
      context: {},
    }),
  );
}

async function publishedOrg(a: Seeded, name: string) {
  await saveNewOrg(a, a.manager.cookie, name);
  return prisma.organization.findFirstOrThrow({ where: { tenantId: a.tenantId, name } });
}

type Confirmation = { count: number; submissionsHref: string } | null;

async function submitDrafts(a: Seeded, cookie: string, ids: string[]) {
  const result = await run(() =>
    submitDraftsAction({
      request: post(a, cookie, "approvals/submit-drafts", { "ids[]": ids }),
      params: { tenant: a.slug },
      context: {},
    }),
  );
  return payloadOf<{ confirmation: Confirmation }>(result);
}

async function draftIds(a: Seeded) {
  const drafts = await prisma.changeRequest.findMany({
    where: { tenantId: a.tenantId, status: "DRAFT" },
  });
  return drafts.map((d) => d.id);
}

describe("submitted-for-review confirmation", () => {
  it("confirms a focal person's submitted create, edit and delete, linking to their submissions", async () => {
    const a = await arrange();
    const toRename = await publishedOrg(a, "Rename Me");
    const toDelete = await publishedOrg(a, "Delete Me");

    await saveNewOrg(a, a.focal.cookie, "Brand New");
    await run(() =>
      organizationEditorAction({
        request: post(
          a,
          a.focal.cookie,
          `organizations/${toRename.id}/edit`,
          orgForm(a, "Renamed", { id: toRename.id, baseVersion: String(toRename.version) }),
        ),
        params: { tenant: a.slug, orgId: toRename.id },
        context: {},
      }),
    );
    await run(() =>
      deleteOrganizationAction({
        request: post(a, a.focal.cookie, `organizations/${toDelete.id}/delete`),
        params: { tenant: a.slug, orgId: toDelete.id },
        context: {},
      } as never),
    );
    const ids = await draftIds(a);
    expect(ids).toHaveLength(3);

    const { confirmation } = await submitDrafts(a, a.focal.cookie, ids);

    expect(confirmation).toEqual({
      count: 3,
      submissionsHref: `/${a.slug}/directory/submissions`,
    });

    // The link lands on the author's own list, where the submitted changes are.
    const submissions = await submissionsLoader({
      request: new Request(`http://localhost${confirmation!.submissionsHref}`, {
        headers: { cookie: a.focal.cookie },
      }),
      params: { tenant: a.slug },
      context: {},
    } as never);
    const rows = payloadOf<{ changes: { operation: string; status: string }[] }>(submissions);
    expect(rows.changes.map((c) => `${c.operation} ${c.status}`).sort()).toEqual([
      "CREATE PENDING",
      "DELETE PENDING",
      "UPDATE PENDING",
    ]);
  });

  it("gives no confirmation when nothing was submitted", async () => {
    const a = await arrange();
    await saveNewOrg(a, a.focal.cookie, "Only Once");
    const ids = await draftIds(a);
    await submitDrafts(a, a.focal.cookie, ids);

    const { confirmation } = await submitDrafts(a, a.focal.cookie, ids);

    expect(confirmation).toBeNull();
  });

  it("a manager's save applies directly and gets no confirmation", async () => {
    const a = await arrange();

    const response = await saveNewOrg(a, a.manager.cookie, "Direct Org");

    expect(statusOf(response)).toBe(302);
    const org = await prisma.organization.findFirstOrThrow({ where: { name: "Direct Org" } });
    expect((response as Response).headers.get("location")).toBe(
      `/${a.slug}/directory/organizations/${org.id}`,
    );
    expect(await draftIds(a)).toEqual([]);

    // Another person's draft is not the manager's to submit.
    await saveNewOrg(a, a.focal.cookie, "Focal Draft");
    const { confirmation } = await submitDrafts(a, a.manager.cookie, await draftIds(a));
    expect(confirmation).toBeNull();
  });
});
