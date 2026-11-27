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
import { mergeDuplicateReferenceData } from "../../prisma/seed-shared-reference-data";
import { runSeed } from "../../prisma/seed";
import { createSessionCookie } from "./helpers/session";

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
    const cookie = await createSessionCookie(prisma, manager.id);
    const params = { tenant: "peacefund" };

    const orgForm = (await newOrganizationLoader(
      args(get(cookie, "/peacefund/organogram/new"), params),
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
      args(get(cookie, "/peacefund/positions/new"), params),
    )) as unknown as { data: { types: { id: string }[] } };
    expect(positionForm.data.types.length).toBeGreaterThan(0);

    const orgSaved = await outcomeOf(async () =>
      organizationAction(
        args(
          await post(cookie, "/peacefund/organogram/new", {
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
      where: { tenantId: tenant.id, name: "Peace Fund Secretariat" },
    });

    const positionSaved = await outcomeOf(async () =>
      positionAction(
        args(
          await post(cookie, "/peacefund/positions/new", {
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
    expect(
      await prisma.position.count({ where: { tenantId: tenant.id, title: "Executive Secretary" } }),
    ).toBe(1);

    const ethiopia = personForm.data.memberStates.find((m) => m.abbreviation === "ETH")!;
    const personSaved = await outcomeOf(async () =>
      personAction(
        args(
          await post(cookie, "/peacefund/people/new", {
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

describe("moving a database that held one copy of the reference data per tenant", () => {
  // The state `db push` leaves behind: the tenant column is gone and each
  // code appears once per tenant that had it, with records in both tenants.
  async function arrangeTwoTenants() {
    const status = await seedActiveUserStatus(prisma);
    const tenants = [
      await prisma.tenant.create({ data: buildTenant({ slug: "system" }) }),
      await prisma.tenant.create({ data: buildTenant({ slug: "misd" }) }),
    ];
    const submitter = await prisma.user.create({
      data: buildUser({ tenantId: tenants[1].id, userStatusId: status.id }),
    });

    const copies = [];
    for (const [i, tenant] of tenants.entries()) {
      const createdAt = new Date(Date.UTC(2026, 0, 1 + i));
      const orgType = await prisma.organizationType.create({
        data: { code: "OFFICE", name: `Office ${tenant.slug}`, level: 3, createdAt },
      });
      const positionType = await prisma.positionType.create({
        data: { code: "DIRECTOR", name: "Director", hierarchyLevel: 3, createdAt },
      });
      const region = await prisma.regionalGroup.create({
        data: { code: "EAST", name: "Eastern Africa", createdAt },
      });
      const memberState = await prisma.memberState.create({
        data: {
          fullName: "Ethiopia",
          abbreviation: "ETH",
          dateJoined: new Date("1963-05-25"),
          createdAt,
          regions: { create: { regionalGroupId: region.id } },
        },
      });
      await prisma.title.create({ data: { code: "DR", name: "Dr.", createdAt } });

      const organization = await prisma.organization.create({
        data: { tenantId: tenant.id, name: `Org ${tenant.slug}`, typeId: orgType.id },
      });
      const position = await prisma.position.create({
        data: {
          tenantId: tenant.id,
          organizationId: organization.id,
          typeId: positionType.id,
          title: `Head ${tenant.slug}`,
        },
      });
      const person = await prisma.person.create({
        data: {
          tenantId: tenant.id,
          firstName: "Person",
          lastName: tenant.slug,
          memberStateId: memberState.id,
          languages: [],
        },
      });
      copies.push({
        tenant,
        orgType,
        positionType,
        region,
        memberState,
        organization,
        position,
        person,
      });
    }
    const [first, second] = copies;

    // Only the second tenant had Kenya, linked to its own copy of the region.
    const kenya = await prisma.memberState.create({
      data: {
        fullName: "Kenya",
        abbreviation: "KEN",
        dateJoined: new Date("1963-12-13"),
        regions: { create: { regionalGroupId: second.region.id } },
      },
    });
    const pending = await prisma.changeRequest.create({
      data: {
        tenantId: second.tenant.id,
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Proposed", typeId: second.orgType.id, isActive: true },
        submittedById: submitter.id,
      },
    });
    return { first, second, kenya, pending };
  }

  async function referenceCodes() {
    return {
      organizationTypes: (await prisma.organizationType.findMany()).map((r) => r.code).sort(),
      positionTypes: (await prisma.positionType.findMany()).map((r) => r.code).sort(),
      regionalGroups: (await prisma.regionalGroup.findMany()).map((r) => r.code).sort(),
      memberStates: (await prisma.memberState.findMany()).map((r) => r.abbreviation).sort(),
      titles: (await prisma.title.findMany()).map((r) => r.code).sort(),
    };
  }

  it("keeps one row per code and every record in both tenants keeps its reference", async () => {
    const a = await arrangeTwoTenants();
    const untouched = await prisma.organization.findUniqueOrThrow({
      where: { id: a.second.organization.id },
    });

    expect(await mergeDuplicateReferenceData(prisma)).toBe(5);

    expect(await referenceCodes()).toEqual({
      organizationTypes: ["OFFICE"],
      positionTypes: ["DIRECTOR"],
      regionalGroups: ["EAST"],
      memberStates: ["ETH", "KEN"],
      titles: ["DR"],
    });

    for (const copy of [a.first, a.second]) {
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: copy.organization.id },
        include: { type: true },
      });
      expect(organization.type.code).toBe("OFFICE");
      expect(organization.typeId).toBe(a.first.orgType.id);
      const position = await prisma.position.findUniqueOrThrow({
        where: { id: copy.position.id },
        include: { type: true },
      });
      expect(position.type.code).toBe("DIRECTOR");
      const person = await prisma.person.findUniqueOrThrow({
        where: { id: copy.person.id },
        include: { memberState: true },
      });
      expect(person.memberState?.abbreviation).toBe("ETH");
    }

    // A data move, not an edit: the record itself is as it was.
    const moved = await prisma.organization.findUniqueOrThrow({
      where: { id: a.second.organization.id },
    });
    expect(moved.updatedAt).toEqual(untouched.updatedAt);
    expect(moved.version).toBe(untouched.version);

    // The oldest copy is the one kept, with its own name.
    expect((await prisma.organizationType.findFirstOrThrow()).name).toBe("Office system");

    // Region memberships survive, pointing at the kept region.
    const links = await prisma.memberStateRegion.findMany({
      include: { memberState: true, regionalGroup: true },
    });
    expect(links.map((l) => `${l.memberState.abbreviation}-${l.regionalGroupId}`).sort()).toEqual([
      `ETH-${a.first.region.id}`,
      `KEN-${a.first.region.id}`,
    ]);

    // A pending change still names a type that exists.
    const pending = await prisma.changeRequest.findUniqueOrThrow({ where: { id: a.pending.id } });
    expect(pending.payload).toEqual({
      name: "Proposed",
      typeId: a.first.orgType.id,
      isActive: true,
    });
  });

  it("changes nothing when run a second time", async () => {
    await arrangeTwoTenants();
    await mergeDuplicateReferenceData(prisma);
    const snapshot = async () => ({
      codes: await referenceCodes(),
      organizations: await prisma.organization.findMany({ orderBy: { id: "asc" } }),
      positions: await prisma.position.findMany({ orderBy: { id: "asc" } }),
      people: await prisma.person.findMany({ orderBy: { id: "asc" } }),
      links: await prisma.memberStateRegion.findMany({ orderBy: { id: "asc" } }),
      changes: await prisma.changeRequest.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await snapshot();

    expect(await mergeDuplicateReferenceData(prisma)).toBe(0);

    expect(await snapshot()).toEqual(before);
  });

  it("is run by the seed, which then adds no second copy", async () => {
    const a = await arrangeTwoTenants();

    await runSeed();

    const offices = await prisma.organizationType.findMany({ where: { code: "OFFICE" } });
    expect(offices.map((o) => o.id)).toEqual([a.first.orgType.id]);
    expect(await prisma.memberState.count({ where: { abbreviation: "ETH" } })).toBe(1);
    expect(await prisma.memberState.count()).toBe(55);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: a.second.organization.id } }))
        .typeId,
    ).toBe(a.first.orgType.id);
  });
});
