import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as approveAction } from "~/routes/$tenant/_directory/approvals/$changeId.approve";
import { loader as personDetailLoader } from "~/routes/$tenant/_directory/people/$personId._layout";
import { action as personDeleteAction } from "~/routes/$tenant/_directory/people/$personId.delete";
import { action as personEditorAction } from "~/routes/$tenant/_directory/people/+shared/person-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

// Ordinary directory conflicts must come back as a form-level message on the
// editor or dialog that was submitted, never as a thrown error (a 500 page).

beforeEach(() => {
  clearFlagCache();
});

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  // The request helpers below address the acting tenant as /medical/...
  const tenant = await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });
  const passwordHash = await hash("test-password", 4);

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

  const resources = ["organization", "person", "position", "position-assignment"];

  const focalRole = await prisma.role.create({
    data: { name: "focal", scope: "TENANT" },
  });
  for (const resource of resources) await grant(focalRole.id, resource, "read");
  await grant(focalRole.id, "directory-change", "submit");

  const managerRole = await prisma.role.create({
    data: { name: "manager", scope: "TENANT" },
  });
  for (const resource of resources) {
    for (const action of ["read", "write", "delete"]) await grant(managerRole.id, resource, action);
  }
  for (const action of ["read-all", "approve", "reject"]) {
    await grant(managerRole.id, "directory-change", action);
  }

  async function user(name: string, roleId: string) {
    return prisma.user.create({
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
  }
  const focal = await user("focal", focalRole.id);
  const manager = await user("manager", managerRole.id);

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

  const orgType = await prisma.organizationType.create({
    data: { code: "ROOT", name: "Root", level: 0 },
  });
  const org = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Commission", typeId: orgType.id },
  });
  const positionType = await prisma.positionType.create({
    data: { code: "DIR", name: "Director" },
  });
  const position = await prisma.position.create({
    data: {
      tenantId: tenant.id,
      organizationId: org.id,
      typeId: positionType.id,
      title: "Director of Testing",
    },
  });
  const person = await prisma.person.create({
    data: { tenantId: tenant.id, firstName: "Ada", lastName: "Okafor" },
  });

  return {
    tenantId: tenant.id,
    focalId: focal.id,
    managerId: manager.id,
    focalSession: await createSessionCookie(prisma, focal.id),
    managerSession: await createSessionCookie(prisma, manager.id),
    org,
    position,
    person,
  };
}

function post(cookie: string, body: Record<string, string>, lang?: "en" | "fr"): Request {
  return new Request("http://localhost/medical", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: lang ? `${cookie}; i18n_lang=${lang}` : cookie,
    },
    body: new URLSearchParams(body).toString(),
  });
}

function get(cookie: string): Request {
  return new Request("http://localhost/medical", { headers: { cookie } });
}

type DataResult = { data: unknown; init: { status?: number } | null };

/**
 * Run a route action and return what it produced. A thrown non-Response is the
 * "server error page" the ticket removes, so it fails the test here.
 */
async function run(action: (args: never) => unknown, request: Request, params: object) {
  const result = await action({
    request,
    params: { tenant: "medical", ...params },
    context: {},
  } as never);
  if (result instanceof Response) throw new Error(`expected a form reply, got ${result.status}`);
  return result as DataResult;
}

/** Form-level errors of a Conform reply (`error[""]`). */
function conformFormErrors(result: DataResult): string[] {
  const reply = result.data as { error?: Record<string, string[] | null> };
  return reply.error?.[""] ?? [];
}

function personForm(person: { id: string; firstName: string; version: number }) {
  return {
    id: person.id,
    baseVersion: String(person.version),
    firstName: person.firstName,
    lastName: "Okafor",
  };
}

describe("directory conflicts return a form-level message", () => {
  it("editing a record that already has a pending change", async () => {
    const a = await arrange();
    await prisma.changeRequest.create({
      data: {
        tenantId: a.tenantId,
        entityType: "PERSON",
        entityId: a.person.id,
        operation: "UPDATE",
        payload: {},
        submittedById: a.managerId,
        status: "PENDING",
        approvalMode: "REVIEWED",
      },
    });

    const result = await run(
      personEditorAction,
      post(a.focalSession, personForm({ ...a.person, firstName: "Adaeze" })),
      { personId: a.person.id },
    );

    expect(result.init?.status).toBe(409);
    expect(conformFormErrors(result)).toEqual([
      "This record already has a change waiting for review. It can be edited again once that change is approved, rejected or withdrawn.",
    ]);
    expect(await prisma.changeRequest.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });
  it("saving a stale edit", async () => {
    const a = await arrange();
    // Someone else published an edit after this user opened the form.
    await prisma.person.update({ where: { id: a.person.id }, data: { version: { increment: 1 } } });

    const result = await run(
      personEditorAction,
      post(a.managerSession, personForm({ ...a.person, firstName: "Adaeze" })),
      { personId: a.person.id },
    );

    expect(result.init?.status).toBe(409);
    expect(conformFormErrors(result)).toEqual([
      "This record was changed by someone else after you opened it. Reload the page and try again.",
    ]);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: a.person.id } });
    expect(person.firstName).toBe("Ada");
  });

  it("answers in French when the user's language is French", async () => {
    const a = await arrange();
    await prisma.person.update({ where: { id: a.person.id }, data: { version: { increment: 1 } } });

    const result = await run(
      personEditorAction,
      post(a.managerSession, personForm(a.person), "fr"),
      { personId: a.person.id },
    );

    expect(conformFormErrors(result)).toEqual([
      "Cette fiche a été modifiée par quelqu'un d'autre après son ouverture. Rechargez la page et réessayez.",
    ]);
  });

  it("deleting a person who holds a current assignment", async () => {
    const a = await arrange();
    await prisma.positionAssignment.create({
      data: {
        tenantId: a.tenantId,
        positionId: a.position.id,
        personId: a.person.id,
        startDate: new Date("2026-01-01"),
      },
    });

    const result = await run(personDeleteAction, post(a.managerSession, {}), {
      personId: a.person.id,
    });

    expect(result.init?.status).toBe(409);
    expect(result.data).toEqual({
      formError:
        "This record still has a current assignment. End the assignment first, then delete.",
    });
    const person = await prisma.person.findUniqueOrThrow({ where: { id: a.person.id } });
    expect(person.deletedAt).toBeNull();
  });

  it("approving a change whose position has since been deleted", async () => {
    const a = await arrange();
    const change = await prisma.changeRequest.create({
      data: {
        tenantId: a.tenantId,
        entityType: "POSITION_ASSIGNMENT",
        operation: "CREATE",
        payload: { positionId: a.position.id, personId: a.person.id, startDate: "2026-01-01" },
        submittedById: a.focalId,
        status: "PENDING",
        approvalMode: "REVIEWED",
      },
    });
    await prisma.position.update({
      where: { id: a.position.id },
      data: { deletedAt: new Date() },
    });

    const result = await run(approveAction, post(a.managerSession, {}), { changeId: change.id });

    expect(result.init?.status).toBe(409);
    expect(result.data).toEqual({
      formError:
        "This change refers to a record that has since been deleted. Reject it or ask for a correction.",
    });
    // Still reviewable: the manager can reject it.
    const after = await prisma.changeRequest.findUniqueOrThrow({ where: { id: change.id } });
    expect(after.status).toBe("PENDING");
    expect(await prisma.positionAssignment.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it("approving a change whose member state has since been deleted", async () => {
    const a = await arrange();
    const memberState = await prisma.memberState.create({
      data: {
        fullName: "Testland",
        abbreviation: "TL",
        dateJoined: new Date("1963-05-25"),
        deletedAt: new Date(),
      },
    });
    const change = await prisma.changeRequest.create({
      data: {
        tenantId: a.tenantId,
        entityType: "PERSON",
        operation: "CREATE",
        payload: { firstName: "Kofi", lastName: "Mensah", memberStateId: memberState.id },
        submittedById: a.focalId,
        status: "PENDING",
        approvalMode: "REVIEWED",
      },
    });

    const result = await run(approveAction, post(a.managerSession, {}), { changeId: change.id });

    expect(result.init?.status).toBe(409);
    expect(result.data).toEqual({
      formError:
        "This change refers to a record that has since been deleted. Reject it or ask for a correction.",
    });
    const after = await prisma.changeRequest.findUniqueOrThrow({ where: { id: change.id } });
    expect(after.status).toBe("PENDING");
    expect(await prisma.person.count({ where: { tenantId: a.tenantId, lastName: "Mensah" } })).toBe(
      0,
    );
  });
});

describe("a record with a pending change is locked", () => {
  async function detail(cookie: string, personId: string) {
    const result = (await personDetailLoader({
      request: get(cookie),
      params: { tenant: "medical", personId },
      context: {},
    } as never)) as unknown as { data: { pendingChange: { submittedById: string } | null } };
    return result.data;
  }

  it("the detail page reports the pending change that disables Edit and Delete", async () => {
    const a = await arrange();
    expect((await detail(a.focalSession, a.person.id)).pendingChange).toBeNull();

    await prisma.changeRequest.create({
      data: {
        tenantId: a.tenantId,
        entityType: "PERSON",
        entityId: a.person.id,
        operation: "UPDATE",
        payload: {},
        submittedById: a.focalId,
        status: "PENDING",
        approvalMode: "REVIEWED",
      },
    });

    expect((await detail(a.managerSession, a.person.id)).pendingChange).toMatchObject({
      submittedById: a.focalId,
    });
  });

  it("a change that was approved, rejected or withdrawn no longer locks the record", async () => {
    const a = await arrange();
    for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) {
      await prisma.changeRequest.create({
        data: {
          tenantId: a.tenantId,
          entityType: "PERSON",
          entityId: a.person.id,
          operation: "UPDATE",
          payload: {},
          submittedById: a.focalId,
          status,
          approvalMode: "REVIEWED",
        },
      });
    }

    expect((await detail(a.focalSession, a.person.id)).pendingChange).toBeNull();
  });
});
