import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as acceptInviteAction } from "~/routes/_auth/accept-invite";
import {
  action as inviteAction,
  loader as inviteLoader,
} from "~/routes/$tenant/settings/security/users/invite";
import { honeypot } from "~/utils/auth/honeypot.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { grantPermissions } from "./helpers/directory-actors";
import { get, payloadOf, post, routeArgs, run, statusOf } from "./helpers/requests";
import { createSessionCookie } from "./helpers/session";

// The system tenant holds no focal person or manager. An invitation is one
// more way to hand out a role, so it follows the same rule when it is sent
// and when it is accepted.

beforeEach(() => clearFlagCache());

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const working = await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const readerRole = await prisma.role.create({ data: { name: "user", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  await grantPermissions(prisma, adminRole.id, [["user", "create"]], "system");

  const admin = await prisma.user.create({
    data: {
      ...buildUser({ tenantId: system.id, userStatusId: status.id }),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  return {
    status,
    system,
    working,
    admin,
    readerRole,
    managerRole,
    adminCookie: await createSessionCookie(prisma, admin.id),
  };
}

async function invite(cookie: string, tenant: string, email: string, roleIds: string[]) {
  const request = await post(`/${tenant}/settings/security/users/invite`, cookie, [
    ["email", email],
    ...roleIds.map((id): [string, string] => ["roleIds", id]),
  ]);
  return run(() => inviteAction(routeArgs(request, { tenant })));
}

async function offeredRoles(cookie: string, tenant: string) {
  const result = await run(() =>
    inviteLoader(routeArgs(get(`/${tenant}/settings/security/users/invite`, cookie), { tenant })),
  );
  return payloadOf<{ roles: { name: string }[] }>(result).roles.map((r) => r.name);
}

async function accept(fields: Record<string, string>, cookie?: string) {
  const honeypotProps = await honeypot.getInputProps();
  const request = await post("/accept-invite", cookie, {
    ...fields,
    [honeypotProps.nameFieldName]: "",
    ...(honeypotProps.validFromFieldName && {
      [honeypotProps.validFromFieldName]: honeypotProps.encryptedValidFrom,
    }),
  });
  return run(() => acceptInviteAction(routeArgs(request)));
}

/** An invitation written before the rule existed. */
async function legacyInvitation(a: Awaited<ReturnType<typeof arrange>>, email: string) {
  return prisma.invitation.create({
    data: {
      email,
      tenantId: a.system.id,
      roleIds: [a.managerRole.id],
      token: `token-${email}`,
      invitedById: a.admin.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

describe("inviting into the system tenant", () => {
  it("refuses an invitation that carries a manager role", async () => {
    const a = await arrange();

    const result = await invite(a.adminCookie, "system", "new@example.org", [a.managerRole.id]);

    expect(statusOf(result)).toBe(400);
    expect(JSON.stringify(payloadOf(result))).toContain("system tenant");
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("still sends an invitation that carries no tenant role", async () => {
    const a = await arrange();

    const result = await invite(a.adminCookie, "system", "new@example.org", [a.readerRole.id]);

    expect(statusOf(result)).toBe(302);
    expect(await prisma.invitation.count()).toBe(1);
  });

  it("does not offer tenant roles on the form", async () => {
    const a = await arrange();

    expect(await offeredRoles(a.adminCookie, "system")).toEqual(["admin", "user"]);
    expect(await offeredRoles(a.adminCookie, "medical")).toEqual(["admin", "manager", "user"]);
  });
});

describe("inviting from another tenant's screen", () => {
  it("invites a manager into that tenant, not the admin's home tenant", async () => {
    const a = await arrange();

    const result = await invite(a.adminCookie, "medical", "new@example.org", [a.managerRole.id]);

    expect(statusOf(result)).toBe(302);
    const invitation = await prisma.invitation.findFirstOrThrow();
    expect(invitation.tenantId).toBe(a.working.id);
  });
});

describe("accepting an invitation into the system tenant", () => {
  it("does not create a manager account from an old invitation", async () => {
    const a = await arrange();
    const invitation = await legacyInvitation(a, "old@example.org");

    const result = await accept({
      token: invitation.token,
      intent: "signup",
      firstName: "Old",
      lastName: "Invite",
      password: "Sup3rSecret!pw",
      confirmPassword: "Sup3rSecret!pw",
    });

    expect(statusOf(result)).toBe(400);
    expect(JSON.stringify(payloadOf(result))).toContain("system tenant");
    expect(await prisma.user.count({ where: { email: "old@example.org" } })).toBe(0);
    expect((await prisma.invitation.findFirstOrThrow()).status).toBe("PENDING");
  });

  it("does not make a signed-in system-tenant user a manager", async () => {
    const a = await arrange();
    const reader = await prisma.user.create({
      data: {
        ...buildUser({ tenantId: a.system.id, userStatusId: a.status.id }),
        email: "reader@example.org",
        userRoles: { create: { roleId: a.readerRole.id } },
      },
    });
    const invitation = await legacyInvitation(a, reader.email);

    const result = await accept(
      { token: invitation.token, intent: "accept" },
      await createSessionCookie(prisma, reader.id),
    );

    expect(statusOf(result)).toBe(400);
    const roles = await prisma.userRole.findMany({ where: { userId: reader.id } });
    expect(roles.map((r) => r.roleId)).toEqual([a.readerRole.id]);
  });

  it("grants the invited role in a working tenant once, even when already held", async () => {
    const a = await arrange();
    const member = await prisma.user.create({
      data: {
        ...buildUser({ tenantId: a.working.id, userStatusId: a.status.id }),
        email: "member@example.org",
        userRoles: { create: { roleId: a.managerRole.id } },
      },
    });
    const invitation = await prisma.invitation.create({
      data: {
        email: member.email,
        tenantId: a.working.id,
        roleIds: [a.managerRole.id, a.readerRole.id],
        token: "token-member",
        invitedById: a.admin.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await accept(
      { token: invitation.token, intent: "accept" },
      await createSessionCookie(prisma, member.id),
    );

    expect(statusOf(result)).toBe(302);
    const roles = await prisma.userRole.findMany({ where: { userId: member.id } });
    expect(roles.map((r) => r.roleId).sort()).toEqual([a.managerRole.id, a.readerRole.id].sort());
  });
});
