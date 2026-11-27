import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as deleteAction } from "~/routes/$tenant/settings/security/users/$userId/delete";
import { action as editAction } from "~/routes/$tenant/settings/security/users/$userId/edit";
import { action as newAction } from "~/routes/$tenant/settings/security/users/new";
import { csrf } from "~/utils/auth/csrf.server";
import { createSessionCookie } from "./helpers/session";

// A user's email is unique across the whole system, not per tenant. A clash
// is reported on the email field; deleting a user frees their address.

const TAKEN_MESSAGE = "A user with this email already exists";

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const [home, other] = await Promise.all([
    // The requests below are made under `/t/...`, the admin's own tenant.
    prisma.tenant.create({ data: buildTenant({ slug: "t" }) }),
    prisma.tenant.create({ data: buildTenant() }),
  ]);

  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  for (const action of ["create", "update", "delete"]) {
    await prisma.permission.create({
      data: {
        resource: "user",
        action,
        module: "security",
        rolePermissions: { create: { roleId: adminRole.id, access: "any" } },
      },
    });
  }

  const mkUser = (tenantId: string, roleIds: string[] = []) =>
    prisma.user.create({
      data: {
        ...buildUser(),
        tenantId,
        userStatusId: status.id,
        userRoles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });

  const admin = await mkUser(home.id, [adminRole.id]);
  // Second admin, so deleting a user never trips the last-admin guard.
  await mkUser(home.id, [adminRole.id]);
  const colleague = await mkUser(home.id);
  const outsider = await mkUser(other.id);

  return {
    home,
    colleague,
    outsider,
    adminCookie: await createSessionCookie(prisma, admin.id),
  };
}

async function post(cookie: string, fields: [string, string][]) {
  const form = new URLSearchParams();
  let cookieHeader = cookie;
  const [token, csrfCookie] = await csrf.commitToken();
  form.set("csrf", token);
  if (csrfCookie) cookieHeader = `${cookie}; ${csrfCookie.split(";")[0]}`;
  for (const [k, v] of fields) form.append(k, v);
  return new Request("http://localhost/t/settings/security/users/x", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
    body: form.toString(),
  });
}

const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params: { tenant: "t", ...params }, context: {} }) as never;

type Outcome = {
  status: number;
  location: string | null;
  emailErrors: string[] | undefined;
};

/** Flattens a redirect Response or a `data()` form reply into one shape. */
async function outcomeOf(promise: Promise<unknown>): Promise<Outcome> {
  const result = (await promise.catch((err) => err)) as
    | Response
    | { init?: { status?: number } | null; data?: { error?: Record<string, string[]> } };
  if (result instanceof Response) {
    return {
      status: result.status,
      location: result.headers.get("location"),
      emailErrors: undefined,
    };
  }
  return {
    status: result?.init?.status ?? 200,
    location: null,
    emailErrors: result?.data?.error?.email,
  };
}

const newUserFields = (email: string, tenantId: string): [string, string][] => [
  ["firstName", "New"],
  ["lastName", "Person"],
  ["email", email],
  ["password", "Passw0rdOK"],
  ["tenantId", tenantId],
];

const editFields = (email: string, tenantId: string): [string, string][] => [
  ["firstName", "Edited"],
  ["lastName", "Person"],
  ["email", email],
  ["tenantId", tenantId],
];

describe("user emails are unique across the system", () => {
  it("creating a user with an email used in another tenant is a field error", async () => {
    const a = await arrange();
    const request = await post(a.adminCookie, newUserFields(a.outsider.email, a.home.id));

    const outcome = await outcomeOf(newAction(args(request)));

    expect(outcome.status).toBe(400);
    expect(outcome.emailErrors).toEqual([TAKEN_MESSAGE]);
    expect(await prisma.user.count({ where: { email: a.outsider.email } })).toBe(1);
  });

  it("the clash is found whatever the letter case", async () => {
    const a = await arrange();
    const request = await post(
      a.adminCookie,
      newUserFields(a.outsider.email.toUpperCase(), a.home.id),
    );

    const outcome = await outcomeOf(newAction(args(request)));

    expect(outcome.status).toBe(400);
    expect(outcome.emailErrors).toEqual([TAKEN_MESSAGE]);
  });

  it("editing a user to an email used in another tenant is a field error", async () => {
    const a = await arrange();
    const request = await post(a.adminCookie, editFields(a.outsider.email, a.home.id));

    const outcome = await outcomeOf(editAction(args(request, { userId: a.colleague.id })));

    expect(outcome.status).toBe(400);
    expect(outcome.emailErrors).toEqual([TAKEN_MESSAGE]);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.colleague.id } });
    expect(after.email).toBe(a.colleague.email);
    expect(after.firstName).toBe(a.colleague.firstName);
  });

  it("editing a user while keeping their own email succeeds", async () => {
    const a = await arrange();
    const request = await post(a.adminCookie, editFields(a.colleague.email, a.home.id));

    const outcome = await outcomeOf(editAction(args(request, { userId: a.colleague.id })));

    expect(outcome.status).toBe(302);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.colleague.id } });
    expect(after.firstName).toBe("Edited");
  });

  it("the email of a deleted user can be given to a new user", async () => {
    const a = await arrange();
    const email = a.outsider.email;
    const del = await outcomeOf(
      deleteAction(args(await post(a.adminCookie, []), { userId: a.outsider.id })),
    );
    expect(del.status).toBe(302);

    const outcome = await outcomeOf(
      newAction(args(await post(a.adminCookie, newUserFields(email, a.home.id)))),
    );

    expect(outcome.status).toBe(302);
    const holders = await prisma.user.findMany({ where: { email } });
    expect(holders).toHaveLength(1);
    expect(holders[0].id).not.toBe(a.outsider.id);
    expect(holders[0].deletedAt).toBeNull();
  });

  it("the email of a deleted user can be given to an existing user", async () => {
    const a = await arrange();
    const email = a.outsider.email;
    await deleteAction(args(await post(a.adminCookie, []), { userId: a.outsider.id }));

    const outcome = await outcomeOf(
      editAction(
        args(await post(a.adminCookie, editFields(email, a.home.id)), { userId: a.colleague.id }),
      ),
    );

    expect(outcome.status).toBe(302);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.colleague.id } });
    expect(after.email).toBe(email);
  });
});
