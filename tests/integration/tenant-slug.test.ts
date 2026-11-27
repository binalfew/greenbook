import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { action as editTenantAction } from "~/routes/$tenant/tenants/$tenantId/edit";
import { action as newTenantAction } from "~/routes/$tenant/tenants/new";
import { csrf } from "~/utils/auth/csrf.server";
import { createSessionCookie } from "./helpers/session";

// Drives the tenant create and edit forms the way the global admin's browser
// does, and asserts what comes back: a redirect, or a 400 carrying an error
// on the slug field.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  // Tenant creation attaches the platform-wide roles, so they must exist.
  await prisma.role.createMany({
    data: [
      { name: "manager", scope: "TENANT" },
      { name: "focal", scope: "TENANT" },
      { name: "user", scope: "GLOBAL" },
    ],
  });
  const admin = await prisma.user.create({
    data: {
      ...buildUser({ tenantId: system.id, userStatusId: status.id }),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  return { system, session: await createSessionCookie(prisma, admin.id) };
}

async function post(url: string, session: string, body: Record<string, string>): Promise<Request> {
  const [token, csrfCookie] = await csrf.commitToken();
  const form = new URLSearchParams({ ...body, csrf: token });
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${session}; ${csrfCookie!.split(";")[0]}`,
    },
    body: form.toString(),
  });
}

type Outcome = { status: number; slugErrors: string[] | undefined };

// A successful action returns a redirect Response; a rejected form returns
// `data(submission.reply(), { status: 400 })`.
function outcome(result: unknown): Outcome {
  if (result instanceof Response) return { status: result.status, slugErrors: undefined };
  const { data, init } = result as {
    data: { error?: Record<string, string[] | null> };
    init: { status?: number } | null;
  };
  return { status: init?.status ?? 200, slugErrors: data.error?.slug ?? undefined };
}

async function createTenant(session: string, fields: Record<string, string>) {
  const request = await post("/system/tenants/new", session, {
    name: "Medical Services",
    email: "medical@example.org",
    phone: "+251 11 000 0000",
    ...fields,
  });
  return outcome(await newTenantAction({ request, params: { tenant: "system" }, context: {} }));
}

async function editTenant(session: string, tenantId: string, fields: Record<string, string>) {
  const request = await post(`/system/tenants/${tenantId}/edit`, session, fields);
  return outcome(
    await editTenantAction({ request, params: { tenant: "system", tenantId }, context: {} }),
  );
}

describe("creating a tenant", () => {
  it("creates the tenant when the slug is free", async () => {
    const { session } = await arrange();

    const result = await createTenant(session, { slug: "medical" });

    expect(result.status).toBe(302);
    expect(await prisma.tenant.count({ where: { slug: "medical" } })).toBe(1);
  });

  it.each(["healthz", "up", "sso", "api", "login"])(
    "shows a slug error for the reserved slug %s",
    async (slug) => {
      const { session } = await arrange();

      const result = await createTenant(session, { slug });

      expect(result.status).toBe(400);
      expect(result.slugErrors).toEqual(["This slug is reserved and cannot be used"]);
      expect(await prisma.tenant.count({ where: { slug } })).toBe(0);
    },
  );

  it("shows a slug error when another tenant already uses the slug", async () => {
    const { session } = await arrange();
    await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });

    const result = await createTenant(session, { slug: "medical" });

    expect(result.status).toBe(400);
    expect(result.slugErrors).toEqual(["This slug is already used by another tenant"]);
    expect(await prisma.tenant.count({ where: { slug: "medical" } })).toBe(1);
  });

  it("shows a slug error when a deleted tenant still holds the slug", async () => {
    const { session } = await arrange();
    await prisma.tenant.create({
      data: buildTenant({ slug: "medical", deletedAt: new Date() }),
    });

    const result = await createTenant(session, { slug: "medical" });

    expect(result.status).toBe(400);
    expect(result.slugErrors).toEqual(["This slug is already used by another tenant"]);
  });
});

describe("editing a tenant", () => {
  it("saves when the slug is unchanged", async () => {
    const { session } = await arrange();
    const tenant = await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });

    const result = await editTenant(session, tenant.id, { slug: "medical", name: "Medical" });

    expect(result.status).toBe(302);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).name).toBe(
      "Medical",
    );
  });

  it("saves the system tenant under its own slug", async () => {
    const { session, system } = await arrange();

    const result = await editTenant(session, system.id, { slug: "system", name: "Platform" });

    expect(result.status).toBe(302);
  });

  it.each(["healthz", "sso"])("shows a slug error for the reserved slug %s", async (slug) => {
    const { session } = await arrange();
    const tenant = await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });

    const result = await editTenant(session, tenant.id, { slug });

    expect(result.status).toBe(400);
    expect(result.slugErrors).toEqual(["This slug is reserved and cannot be used"]);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).slug).toBe(
      "medical",
    );
  });

  it("shows a slug error when another tenant already uses the slug", async () => {
    const { session } = await arrange();
    await prisma.tenant.create({ data: buildTenant({ slug: "legal" }) });
    const tenant = await prisma.tenant.create({ data: buildTenant({ slug: "medical" }) });

    const result = await editTenant(session, tenant.id, { slug: "legal" });

    expect(result.status).toBe(400);
    expect(result.slugErrors).toEqual(["This slug is already used by another tenant"]);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).slug).toBe(
      "medical",
    );
  });
});
