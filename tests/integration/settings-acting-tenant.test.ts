import { describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import {
  action as featuresAction,
  loader as featuresLoader,
} from "~/routes/$tenant/settings/features";
import { loader as usersLoader } from "~/routes/$tenant/settings/security/users/index";
import {
  action as newUserAction,
  loader as newUserLoader,
} from "~/routes/$tenant/settings/security/users/new";
import { grantPermissions } from "./helpers/directory-actors";
import { get, payloadOf, post, routeArgs, run, statusOf } from "./helpers/requests";
import { createSessionCookie } from "./helpers/session";

// The settings pages under `/:tenant/settings` act on the tenant in the URL.
// A tenant's own staff reach them for their tenant and for no other.

async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const [home, other] = await Promise.all([
    prisma.tenant.create({ data: buildTenant() }),
    prisma.tenant.create({ data: buildTenant() }),
  ]);
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  await grantPermissions(
    prisma,
    managerRole.id,
    [
      ["user", "read"],
      ["user", "create"],
      ["feature-flag", "read"],
      ["feature-flag", "write"],
    ],
    "security",
  );
  const mkUser = (tenantId: string) =>
    prisma.user.create({
      data: {
        ...buildUser(),
        tenantId,
        userStatusId: status.id,
        userRoles: { create: { roleId: managerRole.id } },
      },
    });
  const manager = await mkUser(home.id);
  const outsider = await mkUser(other.id);
  const flag = await prisma.featureFlag.create({
    data: { key: "FF_I18N", scope: "global", enabled: true },
  });
  return {
    home,
    other,
    manager,
    outsider,
    flag,
    cookie: await createSessionCookie(prisma, manager.id),
  };
}

describe("tenant settings pages", () => {
  it("list the users of the tenant in the URL to its own staff only", async () => {
    const a = await arrange();
    const at = (slug: string) =>
      run(() =>
        usersLoader(routeArgs(get(`/${slug}/settings/security/users`, a.cookie), { tenant: slug })),
      );

    const own = await at(a.home.slug);
    expect(statusOf(own)).toBe(200);
    expect(payloadOf<{ users: { id: string }[] }>(own).users.map((u) => u.id)).toEqual([
      a.manager.id,
    ]);
    expect(statusOf(await at(a.other.slug))).toBe(403);
  });

  it("offer the new-user form for the tenant in the URL to its own staff only", async () => {
    const a = await arrange();
    const path = (slug: string) => `/${slug}/settings/security/users/new`;

    const own = await run(() =>
      newUserLoader(routeArgs(get(path(a.home.slug), a.cookie), { tenant: a.home.slug })),
    );
    expect(statusOf(own)).toBe(200);

    const elsewhere = await run(() =>
      newUserLoader(routeArgs(get(path(a.other.slug), a.cookie), { tenant: a.other.slug })),
    );
    expect(statusOf(elsewhere)).toBe(403);

    const created = await run(async () =>
      newUserAction(
        routeArgs(
          await post(path(a.other.slug), a.cookie, {
            firstName: "New",
            lastName: "Person",
            email: "new.person@example.org",
            password: "Passw0rdOK",
          }),
          { tenant: a.other.slug },
        ),
      ),
    );
    expect(statusOf(created)).toBe(403);
    expect(await prisma.user.count({ where: { email: "new.person@example.org" } })).toBe(0);
  });

  it("show and change feature flags for the tenant in the URL to its own staff only", async () => {
    const a = await arrange();
    const path = (slug: string) => `/${slug}/settings/features`;

    const own = await run(() =>
      featuresLoader(routeArgs(get(path(a.home.slug), a.cookie), { tenant: a.home.slug })),
    );
    expect(statusOf(own)).toBe(200);

    const elsewhere = await run(() =>
      featuresLoader(routeArgs(get(path(a.other.slug), a.cookie), { tenant: a.other.slug })),
    );
    expect(statusOf(elsewhere)).toBe(403);

    const toggled = await run(async () =>
      featuresAction(
        routeArgs(await post(path(a.other.slug), a.cookie, { flagId: a.flag.id, enabled: "off" }), {
          tenant: a.other.slug,
        }),
      ),
    );
    expect(statusOf(toggled)).toBe(403);
    const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { id: a.flag.id } });
    expect(flag.disabledForTenants).toEqual([]);
  });
});
