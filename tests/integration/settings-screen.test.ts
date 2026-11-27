import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as editLoader } from "~/routes/$tenant/settings/$key.edit";
import { loader as settingsLoader } from "~/routes/$tenant/settings/index";
import { createSessionCookie } from "./helpers/session";

// The settings screen lists only keys that some code reads. Today that is the
// supported-languages key, which the tenant layout reads to build the
// language switcher.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant({ slug: "t" }) });
  const role = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const perm = await prisma.permission.create({
    data: { resource: "settings", action: "read", module: "system" },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionId: perm.id, access: "any" },
  });
  const admin = await prisma.user.create({
    data: {
      ...buildUser(),
      tenantId: tenant.id,
      userStatusId: status.id,
      userRoles: { create: { roleId: role.id } },
    },
  });
  return { tenant, cookie: await createSessionCookie(prisma, admin.id) };
}

const args = (cookie: string, params: Record<string, string> = {}) =>
  ({
    request: new Request("http://localhost/t/settings", { headers: { cookie } }),
    params: { tenant: "t", ...params },
    context: {},
  }) as never;

async function listedKeys(cookie: string): Promise<string[]> {
  const result = (await settingsLoader(args(cookie))) as unknown as {
    data: { grouped: Record<string, { key: string }[]> };
  };
  return Object.values(result.data.grouped)
    .flat()
    .map((s) => s.key);
}

describe("the settings screen", () => {
  it("lists only the supported-languages key", async () => {
    const { cookie } = await arrange();
    expect(await listedKeys(cookie)).toEqual(["i18n.supported_languages"]);
  });

  it("does not list a stored value for a key nothing reads", async () => {
    const { cookie } = await arrange();
    await prisma.systemSetting.create({
      data: {
        key: "auth.session_timeout_minutes",
        value: "15",
        type: "number",
        category: "auth",
        scope: "global",
        scopeId: "",
      },
    });
    expect(await listedKeys(cookie)).toEqual(["i18n.supported_languages"]);
  });

  it("refuses to open the editor for a key nothing reads", async () => {
    const { cookie } = await arrange();
    const refused = (await editLoader(args(cookie, { key: "auth.session_timeout_minutes" })).catch(
      (err: unknown) => err,
    )) as { init?: { status?: number } };
    expect(refused.init?.status).toBe(404);

    const opened = (await editLoader(
      args(cookie, { key: "i18n.supported_languages" }),
    )) as unknown as { data: { key: string } };
    expect(opened.data.key).toBe("i18n.supported_languages");
  });
});
