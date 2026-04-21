import { afterEach, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { submitAndApply } from "~/services/directory-changes.server";
import { clearPublicTenantIdsCache, getPublicTenantIds } from "~/services/public-directory.server";
import {
  publicGetOrganization,
  publicListOrganizationChildren,
  publicListOrganizationTreeRoots,
} from "~/services/organizations.server";
import { publicGetPerson, publicListPeople } from "~/services/people.server";
import { publicGetPosition } from "~/services/positions.server";

/**
 * Phase D — public cross-tenant tier invariants.
 *
 * These tests guard three rules:
 * 1. Opt-out tenants are invisible to every `public*` helper.
 * 2. `publicGet*` / `publicList*` response shapes never include `tenantId`.
 * 3. `publicListPeople` / `publicGetPerson` honour each person's
 *    `showEmail` / `showPhone` toggles — PII is stripped when false.
 */

type Arranged = {
  tenantA: { id: string };
  tenantB: { id: string };
  userA: { id: string };
  userB: { id: string };
  orgTypeA: { id: string };
  orgTypeB: { id: string };
  posTypeA: { id: string };
  memberStateA: { id: string };
};

async function arrange(): Promise<Arranged> {
  const status = await seedActiveUserStatus(prisma);
  const tenantA = await prisma.tenant.create({ data: buildTenant() });
  const tenantB = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("t", 4);
  const userA = await prisma.user.create({
    data: {
      email: `a-${tenantA.id}@t.com`,
      firstName: "A",
      lastName: "User",
      tenantId: tenantA.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `b-${tenantB.id}@t.com`,
      firstName: "B",
      lastName: "User",
      tenantId: tenantB.id,
      userStatusId: status.id,
      password: { create: { hash: passwordHash } },
    },
  });
  const orgTypeA = await prisma.organizationType.create({
    data: { tenantId: tenantA.id, code: "ROOT", name: "Root", level: 0 },
  });
  const orgTypeB = await prisma.organizationType.create({
    data: { tenantId: tenantB.id, code: "ROOT", name: "Root", level: 0 },
  });
  const posTypeA = await prisma.positionType.create({
    data: { tenantId: tenantA.id, code: "DIRECTOR", name: "Director", hierarchyLevel: 3 },
  });
  const rg = await prisma.regionalGroup.create({
    data: { tenantId: tenantA.id, code: "EAST", name: "Eastern Africa" },
  });
  const memberStateA = await prisma.memberState.create({
    data: {
      tenantId: tenantA.id,
      fullName: "Ethiopia",
      abbreviation: "ET",
      dateJoined: new Date("1963-05-25"),
      regions: { create: { regionalGroupId: rg.id } },
    },
  });
  return {
    tenantA: { id: tenantA.id },
    tenantB: { id: tenantB.id },
    userA: { id: userA.id },
    userB: { id: userB.id },
    orgTypeA: { id: orgTypeA.id },
    orgTypeB: { id: orgTypeB.id },
    posTypeA: { id: posTypeA.id },
    memberStateA: { id: memberStateA.id },
  };
}

async function optInTenants(ids: string[]) {
  await prisma.featureFlag.upsert({
    where: { key: "FF_PUBLIC_DIRECTORY" },
    update: { enabledForTenants: { set: ids }, scope: "tenant", enabled: false },
    create: {
      key: "FF_PUBLIC_DIRECTORY",
      scope: "tenant",
      enabled: false,
      enabledForTenants: ids,
    },
  });
  clearPublicTenantIdsCache();
}

describe("public directory: opt-in gate", () => {
  afterEach(() => {
    clearPublicTenantIdsCache();
  });

  it("hides opted-out tenants from every public helper", async () => {
    const a = await arrange();

    // Create an org in each tenant.
    const visibleRoot = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Visible Root", typeId: a.orgTypeA.id, isActive: true },
      },
      { tenantId: a.tenantA.id, userId: a.userA.id },
    );
    const hiddenRoot = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Hidden Root", typeId: a.orgTypeB.id, isActive: true },
      },
      { tenantId: a.tenantB.id, userId: a.userB.id },
    );

    await optInTenants([a.tenantA.id]);
    const ids = await getPublicTenantIds();
    expect(ids).toEqual([a.tenantA.id]);

    // Roots: only A's root.
    const roots = await publicListOrganizationTreeRoots(ids);
    expect(roots.map((r) => r.name)).toEqual(["Visible Root"]);

    // Direct fetch of tenant B's org must return null.
    const hidden = await publicGetOrganization(hiddenRoot.entity!.id, ids);
    expect(hidden).toBeNull();

    // Children of tenant B's root must not be reachable either.
    const children = await publicListOrganizationChildren(hiddenRoot.entity!.id, ids);
    expect(children).toEqual([]);

    // Sanity: tenant A's org IS fetchable.
    const visible = await publicGetOrganization(visibleRoot.entity!.id, ids);
    expect(visible?.name).toBe("Visible Root");
  });

  it("returns empty with no opt-in tenants", async () => {
    await arrange();
    clearPublicTenantIdsCache();
    await prisma.featureFlag.deleteMany({ where: { key: "FF_PUBLIC_DIRECTORY" } });
    const ids = await getPublicTenantIds();
    expect(ids).toEqual([]);
    const roots = await publicListOrganizationTreeRoots(ids);
    expect(roots).toEqual([]);
  });
});

describe("public directory: response shape invariants", () => {
  afterEach(() => {
    clearPublicTenantIdsCache();
  });

  it("never includes tenantId in any public helper response", async () => {
    const a = await arrange();
    const created = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Shape Root", typeId: a.orgTypeA.id, isActive: true },
      },
      { tenantId: a.tenantA.id, userId: a.userA.id },
    );
    await optInTenants([a.tenantA.id]);
    const ids = await getPublicTenantIds();

    const roots = await publicListOrganizationTreeRoots(ids);
    expect(roots[0]).not.toHaveProperty("tenantId");

    const children = await publicListOrganizationChildren(created.entity!.id, ids);
    // No children seeded; still assert shape is safe on an empty array.
    expect(Array.isArray(children)).toBe(true);

    const org = await publicGetOrganization(created.entity!.id, ids);
    expect(org).not.toBeNull();
    expect(org).not.toHaveProperty("tenantId");
  });
});

describe("public directory: PII strip for people", () => {
  afterEach(() => {
    clearPublicTenantIdsCache();
  });

  it("hides email when showEmail=false and hides phone when showPhone=false", async () => {
    const a = await arrange();
    // Two people: one fully public, one locked down.
    const open = await prisma.person.create({
      data: {
        tenantId: a.tenantA.id,
        firstName: "Open",
        lastName: "Contact",
        email: "open@example.com",
        phone: "+251-11-0000000",
        showEmail: true,
        showPhone: true,
        memberStateId: a.memberStateA.id,
      },
    });
    const closed = await prisma.person.create({
      data: {
        tenantId: a.tenantA.id,
        firstName: "Private",
        lastName: "Contact",
        email: "private@example.com",
        phone: "+251-11-1111111",
        showEmail: false,
        showPhone: false,
      },
    });

    await optInTenants([a.tenantA.id]);
    const ids = await getPublicTenantIds();

    const openRow = await publicGetPerson(open.id, ids);
    expect(openRow?.email).toBe("open@example.com");
    expect(openRow?.phone).toBe("+251-11-0000000");

    const closedRow = await publicGetPerson(closed.id, ids);
    expect(closedRow?.email).toBeNull();
    expect(closedRow?.phone).toBeNull();

    const list = await publicListPeople(ids, {});
    const byName = Object.fromEntries(list.data.map((p) => [p.lastName, p]));
    expect(byName.Contact).toBeDefined();
    // The list respects the same strip.
    const closedInList = list.data.find((p) => p.firstName === "Private");
    expect(closedInList?.email).toBeNull();
    expect(closedInList?.phone).toBeNull();
  });

  it("omits people from opt-out tenants", async () => {
    const a = await arrange();
    const rgB = await prisma.regionalGroup.create({
      data: { tenantId: a.tenantB.id, code: "EAST", name: "Eastern Africa" },
    });
    const msB = await prisma.memberState.create({
      data: {
        tenantId: a.tenantB.id,
        fullName: "Kenya",
        abbreviation: "KE",
        dateJoined: new Date("1963-12-13"),
        regions: { create: { regionalGroupId: rgB.id } },
      },
    });
    await prisma.person.create({
      data: {
        tenantId: a.tenantB.id,
        firstName: "Hidden",
        lastName: "Person",
        memberStateId: msB.id,
      },
    });
    await prisma.person.create({
      data: { tenantId: a.tenantA.id, firstName: "Visible", lastName: "Person" },
    });

    await optInTenants([a.tenantA.id]);
    const ids = await getPublicTenantIds();

    const list = await publicListPeople(ids, {});
    expect(list.data.map((p) => p.firstName).sort()).toEqual(["Visible"]);
  });
});

describe("public directory: publicGetPosition isolation", () => {
  afterEach(() => {
    clearPublicTenantIdsCache();
  });

  it("returns null for a position in an opt-out tenant", async () => {
    const a = await arrange();
    const org = await submitAndApply(
      {
        entityType: "ORGANIZATION",
        operation: "CREATE",
        payload: { name: "Host Org", typeId: a.orgTypeA.id, isActive: true },
      },
      { tenantId: a.tenantA.id, userId: a.userA.id },
    );
    const position = await submitAndApply(
      {
        entityType: "POSITION",
        operation: "CREATE",
        payload: {
          title: "Director",
          organizationId: org.entity!.id,
          typeId: a.posTypeA.id,
          isActive: true,
        },
      },
      { tenantId: a.tenantA.id, userId: a.userA.id },
    );

    // Tenant A is NOT opted in.
    await optInTenants([a.tenantB.id]);
    const ids = await getPublicTenantIds();

    const result = await publicGetPosition(position.entity!.id, ids);
    expect(result).toBeNull();
  });
});
