import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import {
  action as organizationAction,
  loader as newOrganizationLoader,
} from "~/routes/$tenant/_directory/organogram/new";
import {
  action as personAction,
  loader as newPersonLoader,
} from "~/routes/$tenant/_directory/people/new";
import {
  action as positionAction,
  loader as newPositionLoader,
} from "~/routes/$tenant/_directory/positions/new";
import {
  action as deleteOrganizationTypeAction,
  loader as deleteOrganizationTypeLoader,
} from "~/routes/$tenant/settings/references/organization-types/$orgTypeId.delete";
import {
  action as organizationTypeAction,
  loader as editOrganizationTypeLoader,
} from "~/routes/$tenant/settings/references/organization-types/$orgTypeId.edit";
import { loader as organizationTypesLoader } from "~/routes/$tenant/settings/references/organization-types/index";
import { action as newTenantAction } from "~/routes/$tenant/tenants/new";
import { csrf } from "~/utils/auth/csrf.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { runSeed } from "../../prisma/seed";
import { createSessionCookie } from "./helpers/session";
import { personContactFields } from "./helpers/person-form";

// Reference data — member states, regional groups, organization types,
// position types, titles — is one set shared by every tenant. These tests
// drive the route loaders and actions a browser would hit.

beforeEach(() => {
  clearFlagCache();
});

function get(cookie: string, path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { cookie } });
}

async function post(cookie: string, path: string, body: Record<string, string>): Promise<Request> {
  const [token, csrfCookie] = await csrf.commitToken();
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${cookie}; ${csrfCookie!.split(";")[0]}`,
    },
    body: new URLSearchParams({ ...body, csrf: token }).toString(),
  });
}

type Outcome = { status: number; codeErrors?: string[] | null };

/** Run a loader/action and report its HTTP status, whether returned or thrown. */
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  const result = await run().catch((thrown) => thrown);
  if (result instanceof Response) return { status: result.status };
  if (result instanceof Error) throw result;
  const { data, init } = result as {
    data?: { error?: Record<string, string[] | null> | string };
    init?: { status?: number } | null;
  };
  const error = data?.error;
  return {
    status: init?.status ?? 200,
    codeErrors: error && typeof error === "object" ? error.code : undefined,
  };
}

function args(request: Request, params: Record<string, string>) {
  return { request, params, context: {} } as never;
}

describe("a tenant created through the UI", () => {
  it("can create an organization, a person and a position with every reference list filled", async () => {
    await runSeed();
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.SEED_ADMIN_EMAIL! },
    });
    const adminCookie = await createSessionCookie(prisma, admin.id);

    const created = await outcomeOf(async () =>
      newTenantAction(
        args(
          await post(adminCookie, "/system/tenants/new", {
            name: "Peace Fund",
            email: "peacefund@example.org",
            phone: "+251110000000",
            slug: "peacefund",
          }),
          { tenant: "system" },
        ),
      ),
    );
    expect(created.status).toBe(302);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "peacefund" } });

    // The directory module is switched on per tenant; that is not reference data.
    await prisma.featureFlag.update({
      where: { key: "FF_DIRECTORY" },
      data: { enabledForTenants: { push: tenant.id } },
    });
    clearFlagCache();

    const managerRole = await prisma.role.findFirstOrThrow({ where: { name: "manager" } });
    const manager = await prisma.user.create({
      data: {
        ...buildUser({ tenantId: tenant.id, userStatusId: admin.userStatusId }),
        userRoles: { create: { roleId: managerRole.id } },
      },
    });
    // The global admin keeps the organizational units and positions; the
    // tenant's manager adds the people.
    const cookie = await createSessionCookie(prisma, manager.id);
    const params = { tenant: "peacefund" };

    const orgForm = (await newOrganizationLoader(
      args(get(adminCookie, "/peacefund/organogram/new"), params),
    )) as unknown as { data: { types: { id: string; code: string }[] } };
    expect(orgForm.data.types.map((t) => t.code).sort()).toEqual([
      "DEPARTMENT",
      "MAIN_ORGAN",
      "OFFICE",
      "ROOT",
      "UNIT",
    ]);

    const personForm = (await newPersonLoader(
      args(get(cookie, "/peacefund/people/new"), params),
    )) as unknown as {
      data: { memberStates: { id: string; abbreviation: string }[]; titles: { name: string }[] };
    };
    expect(personForm.data.memberStates).toHaveLength(55);
    expect(personForm.data.titles.length).toBeGreaterThan(0);

    const positionForm = (await newPositionLoader(
      args(get(adminCookie, "/peacefund/positions/new"), params),
    )) as unknown as { data: { types: { id: string }[] } };
    expect(positionForm.data.types.length).toBeGreaterThan(0);

    const orgSaved = await outcomeOf(async () =>
      organizationAction(
        args(
          await post(adminCookie, "/peacefund/organogram/new", {
            name: "Peace Fund Secretariat",
            typeId: orgForm.data.types.find((t) => t.code === "OFFICE")!.id,
            isActive: "true",
            sortOrder: "0",
          }),
          params,
        ),
      ),
    );
    expect(orgSaved.status).toBe(302);
    const org = await prisma.organization.findFirstOrThrow({
      where: { name: "Peace Fund Secretariat" },
    });

    const positionSaved = await outcomeOf(async () =>
      positionAction(
        args(
          await post(adminCookie, "/peacefund/positions/new", {
            title: "Executive Secretary",
            organizationId: org.id,
            typeId: positionForm.data.types[0].id,
            isActive: "true",
            sortOrder: "0",
          }),
          params,
        ),
      ),
    );
    expect(positionSaved.status).toBe(302);
    const position = await prisma.position.findFirstOrThrow({
      where: { title: "Executive Secretary" },
    });

    const ethiopia = personForm.data.memberStates.find((m) => m.abbreviation === "ETH")!;
    const personSaved = await outcomeOf(async () =>
      personAction(
        args(
          await post(cookie, "/peacefund/people/new", {
            ...personContactFields(),
            initialPositionId: position.id,
            initialStartDate: "2026-01-15",
            firstName: "Selam",
            lastName: "Tesfaye",
            honorific: personForm.data.titles[0].name,
            memberStateId: ethiopia.id,
          }),
          params,
        ),
      ),
    );
    expect(personSaved.status).toBe(302);
    const person = await prisma.person.findFirstOrThrow({
      where: { tenantId: tenant.id, lastName: "Tesfaye" },
    });
    expect(person.memberStateId).toBe(ethiopia.id);
  });
});

describe("editing reference data", () => {
  async function arrange() {
    const status = await seedActiveUserStatus(prisma);
    const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
    const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
    const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
    // The tenant role holds every reference-data permission and still may not edit.
    for (const action of ["read", "write", "delete"]) {
      const permission = await prisma.permission.create({
        data: { resource: "reference-data", action, module: "data" },
      });
      await prisma.rolePermission.createMany({
        data: [adminRole.id, managerRole.id].map((roleId) => ({
          roleId,
          permissionId: permission.id,
          access: "any",
        })),
      });
    }
    const mkUser = (roleId: string) =>
      prisma.user.create({
        data: {
          ...buildUser({ tenantId: system.id, userStatusId: status.id }),
          userRoles: { create: { roleId } },
        },
      });
    const admin = await mkUser(adminRole.id);
    const manager = await mkUser(managerRole.id);
    const type = await prisma.organizationType.create({
      data: { code: "ROOT", name: "Root", level: 0 },
    });
    return {
      type,
      adminCookie: await createSessionCookie(prisma, admin.id),
      managerCookie: await createSessionCookie(prisma, manager.id),
    };
  }

  const base = "/system/settings/references/organization-types";
  const params = { tenant: "system" };

  it("lets a tenant manager read the list but not create, edit or delete", async () => {
    const a = await arrange();
    const editParams = { ...params, orgTypeId: a.type.id };

    const list = (await organizationTypesLoader(
      args(get(a.managerCookie, base), params),
    )) as unknown as { data: { items: { code: string }[]; canEdit: boolean } };
    expect(list.data.items.map((i) => i.code)).toEqual(["ROOT"]);
    expect(list.data.canEdit).toBe(false);

    const attempts = [
      () =>
        editOrganizationTypeLoader(
          args(get(a.managerCookie, `${base}/${a.type.id}/edit`), editParams),
        ),
      () =>
        deleteOrganizationTypeLoader(
          args(get(a.managerCookie, `${base}/${a.type.id}/delete`), editParams),
        ),
      async () =>
        organizationTypeAction(
          args(
            await post(a.managerCookie, `${base}/new`, {
              code: "UNIT",
              name: "Unit",
              level: "4",
              sortOrder: "0",
            }),
            params,
          ),
        ),
      async () =>
        organizationTypeAction(
          args(
            await post(a.managerCookie, `${base}/${a.type.id}/edit`, {
              id: a.type.id,
              code: "ROOT",
              name: "Renamed",
              level: "0",
              sortOrder: "0",
            }),
            editParams,
          ),
        ),
      async () =>
        deleteOrganizationTypeAction(
          args(await post(a.managerCookie, `${base}/${a.type.id}/delete`, {}), editParams),
        ),
    ];
    for (const attempt of attempts) {
      expect((await outcomeOf(attempt)).status).toBe(403);
    }
    const rows = await prisma.organizationType.findMany();
    expect(rows.map((r) => [r.code, r.name, r.deletedAt])).toEqual([["ROOT", "Root", null]]);
  });

  it("lets the global admin create, edit and delete, and reports a taken code on the field", async () => {
    const a = await arrange();
    const editParams = { ...params, orgTypeId: a.type.id };

    const list = (await organizationTypesLoader(
      args(get(a.adminCookie, base), params),
    )) as unknown as { data: { canEdit: boolean } };
    expect(list.data.canEdit).toBe(true);

    const unit = { code: "UNIT", name: "Unit", level: "4", sortOrder: "0" };
    const created = await outcomeOf(async () =>
      organizationTypeAction(args(await post(a.adminCookie, `${base}/new`, unit), params)),
    );
    expect(created.status).toBe(302);

    const again = await outcomeOf(async () =>
      organizationTypeAction(args(await post(a.adminCookie, `${base}/new`, unit), params)),
    );
    expect(again.status).toBe(400);
    expect(again.codeErrors).toHaveLength(1);
    expect(await prisma.organizationType.count({ where: { code: "UNIT" } })).toBe(1);

    const renamed = await outcomeOf(async () =>
      organizationTypeAction(
        args(
          await post(a.adminCookie, `${base}/${a.type.id}/edit`, {
            id: a.type.id,
            code: "ROOT",
            name: "Renamed",
            level: "0",
            sortOrder: "0",
          }),
          editParams,
        ),
      ),
    );
    expect(renamed.status).toBe(302);
    expect(
      (await prisma.organizationType.findUniqueOrThrow({ where: { id: a.type.id } })).name,
    ).toBe("Renamed");

    const deleted = await outcomeOf(async () =>
      deleteOrganizationTypeAction(
        args(await post(a.adminCookie, `${base}/${a.type.id}/delete`, {}), editParams),
      ),
    );
    expect(deleted.status).toBe(302);
    expect(
      (await prisma.organizationType.findUniqueOrThrow({ where: { id: a.type.id } })).deletedAt,
    ).not.toBeNull();
  });
});
