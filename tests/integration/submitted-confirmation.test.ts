import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as personEditorAction } from "~/routes/$tenant/_directory/people/+shared/person-editor.server";
import { action as deletePersonAction } from "~/routes/$tenant/_directory/people/$personId.delete";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/submissions/submit-drafts";
import { loader as submissionsLoader } from "~/routes/$tenant/_directory/submissions/index";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import { personForm } from "./helpers/directory-actors";
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

  await grant(focalRole.id, "person", "read");
  await grant(focalRole.id, "directory-change", "submit");
  await grant(focalRole.id, "directory-change", "read-own");
  await grant(focalRole.id, "directory-change", "withdraw-own");

  await grant(managerRole.id, "person", "read");
  await grant(managerRole.id, "person", "write");
  await grant(managerRole.id, "person", "delete");
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
    manager: await user("manager", managerRole.id),
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

/** Save a new person through the editor as the given user. */
function saveNewPerson(a: Seeded, cookie: string, name: string) {
  return run(() =>
    personEditorAction({
      request: post(a, cookie, "people/new", personForm(name)),
      params: { tenant: a.slug },
      context: {},
    }),
  );
}

async function publishedPerson(a: Seeded, name: string) {
  await saveNewPerson(a, a.manager.cookie, name);
  return prisma.person.findFirstOrThrow({ where: { tenantId: a.tenantId, lastName: name } });
}

type Confirmation = { count: number; submissionsHref: string } | null;

async function submitDrafts(a: Seeded, cookie: string, ids: string[]) {
  const result = await run(() =>
    submitDraftsAction({
      request: post(a, cookie, "submissions/submit-drafts", { "ids[]": ids }),
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
    const toRename = await publishedPerson(a, "Rename Me");
    const toDelete = await publishedPerson(a, "Delete Me");

    await saveNewPerson(a, a.focal.cookie, "Brand New");
    await run(() =>
      personEditorAction({
        request: post(
          a,
          a.focal.cookie,
          `people/${toRename.id}/edit`,
          personForm("Renamed", { id: toRename.id, baseVersion: String(toRename.version) }),
        ),
        params: { tenant: a.slug, personId: toRename.id },
        context: {},
      }),
    );
    await run(() =>
      deletePersonAction({
        request: post(a, a.focal.cookie, `people/${toDelete.id}/delete`),
        params: { tenant: a.slug, personId: toDelete.id },
        context: {},
      } as never),
    );
    const ids = await draftIds(a);
    expect(ids).toHaveLength(3);

    const { confirmation } = await submitDrafts(a, a.focal.cookie, ids);

    expect(confirmation).toEqual({
      count: 3,
      submissionsHref: `/${a.slug}/submissions`,
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
    await saveNewPerson(a, a.focal.cookie, "Only Once");
    const ids = await draftIds(a);
    await submitDrafts(a, a.focal.cookie, ids);

    const { confirmation } = await submitDrafts(a, a.focal.cookie, ids);

    expect(confirmation).toBeNull();
  });

  it("a manager's save applies directly and gets no confirmation", async () => {
    const a = await arrange();

    const response = await saveNewPerson(a, a.manager.cookie, "Direct Person");

    expect(statusOf(response)).toBe(302);
    const person = await prisma.person.findFirstOrThrow({ where: { lastName: "Direct Person" } });
    expect((response as Response).headers.get("location")).toBe(`/${a.slug}/people/${person.id}`);
    expect(await draftIds(a)).toEqual([]);

    // Another person's draft is not the manager's to submit.
    await saveNewPerson(a, a.focal.cookie, "Focal Draft");
    const { confirmation } = await submitDrafts(a, a.manager.cookie, await draftIds(a));
    expect(confirmation).toBeNull();
  });
});
