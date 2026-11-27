import { hash } from "bcryptjs";
import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { softDeleteUser } from "~/services/users.server";
import { getUserId, verifyUserPassword } from "~/utils/auth/auth.server";
import { requireUser } from "~/utils/auth/session.server";
import { createSessionCookie } from "./helpers/session";

const PASSWORD = "test-password";

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const user = await prisma.user.create({
    data: {
      ...buildUser(),
      tenantId: tenant.id,
      userStatusId: status.id,
      password: { create: { hash: await hash(PASSWORD, 4) } },
    },
  });
  const cookie = await createSessionCookie(prisma, user.id);
  const request = () => new Request("http://localhost/", { headers: { cookie } });
  const ctx = { tenantId: tenant.id, userId: user.id };
  return { user, cookie, request, ctx };
}

/** Both resolvers refuse by throwing a redirect to /login. */
async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  const result = await promise.catch((err) => err);
  return result instanceof Response ? result.headers.get("location") : null;
}

describe("a deleted user loses access", () => {
  it("resolves the session and password before deletion", async () => {
    const a = await arrange();
    expect((await requireUser(a.request())).id).toBe(a.user.id);
    expect(await getUserId(a.request())).toBe(a.user.id);
    expect(await verifyUserPassword({ email: a.user.email }, PASSWORD)).not.toBeNull();
  });

  it("deleting a user removes their sessions", async () => {
    const a = await arrange();
    await softDeleteUser(a.user.id, a.ctx as never);
    expect(await prisma.session.count({ where: { userId: a.user.id } })).toBe(0);
  });

  it("an existing session cookie stops working", async () => {
    const a = await arrange();
    await softDeleteUser(a.user.id, a.ctx as never);
    expect(await redirectTarget(requireUser(a.request()))).toMatch(/^\/login/);
    expect(await redirectTarget(getUserId(a.request()))).not.toBeNull();
  });

  it("a session that outlives the deletion is still refused", async () => {
    // Sessions can be minted outside softDeleteUser (SSO callback, invite
    // acceptance), so the resolvers must not rely on them having been removed.
    const a = await arrange();
    await prisma.user.update({ where: { id: a.user.id }, data: { deletedAt: new Date() } });
    expect(await prisma.session.count({ where: { userId: a.user.id } })).toBe(1);
    expect(await redirectTarget(requireUser(a.request()))).toMatch(/^\/login/);
    expect(await redirectTarget(getUserId(a.request()))).not.toBeNull();
  });

  it("the password no longer signs in", async () => {
    const a = await arrange();
    await softDeleteUser(a.user.id, a.ctx as never);
    expect(await verifyUserPassword({ email: a.user.email }, PASSWORD)).toBeNull();
  });
});
