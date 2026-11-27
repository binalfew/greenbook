import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as changeDetailLoader } from "~/routes/$tenant/_directory/approvals/$changeId._layout";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/submissions/submit-drafts";
import { action as personEditorAction } from "~/routes/$tenant/_directory/people/+shared/person-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";
import { personContactFields } from "./helpers/person-form";

beforeEach(() => {
  clearFlagCache();
});

type Actor = { id: string; cookie: string };
type Workspace = {
  tenantId: string;
  slug: string;
  focal: Actor;
  otherFocal: Actor;
  manager: Actor;
};
type Seeded = { home: Workspace; other: Workspace };

async function arrange(): Promise<Seeded> {
  const status = await seedActiveUserStatus(prisma);
  const passwordHash = await hash("test-password", 4);

  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });

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

  await grant(focalRole.id, "person", "read");
  await grant(focalRole.id, "directory-change", "submit");
  await grant(focalRole.id, "directory-change", "read-own");

  await grant(managerRole.id, "person", "read");
  await grant(managerRole.id, "person", "write");
  await grant(managerRole.id, "directory-change", "approve");
  await grant(managerRole.id, "directory-change", "reject");
  await grant(managerRole.id, "directory-change", "read-all");

  async function workspace(): Promise<Workspace> {
    const tenant = await prisma.tenant.create({ data: buildTenant() });

    async function user(name: string, roleId: string): Promise<Actor> {
      const created = await prisma.user.create({
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
      return { id: created.id, cookie: await createSessionCookie(prisma, created.id) };
    }

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      focal: await user("focal", focalRole.id),
      otherFocal: await user("other-focal", focalRole.id),
      manager: await user("manager", managerRole.id),
    };
  }

  const home = await workspace();
  const other = await workspace();

  await prisma.featureFlag.upsert({
    where: { key: "FF_DIRECTORY" },
    create: {
      key: "FF_DIRECTORY",
      scope: "tenant",
      enabled: false,
      enabledForTenants: [home.tenantId, other.tenantId],
    },
    update: { enabledForTenants: { set: [home.tenantId, other.tenantId] } },
  });

  return { home, other };
}

function post(
  w: Workspace,
  cookie: string,
  path: string,
  body: Record<string, string | string[]> = {},
): Request {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    for (const item of Array.isArray(v) ? v : [v]) form.append(k, item);
  }
  return new Request(`http://localhost/${w.slug}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: form.toString(),
  });
}

/** Loaders/actions either return or throw a Response / data() wrapper. */
async function run<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

function statusOf(result: unknown): number | undefined {
  if (result instanceof Response) return result.status;
  const init = (result as { init?: { status?: number } | null } | null)?.init;
  return init?.status;
}

type Duplicate = {
  source: "PERSON" | "DRAFT" | "PENDING";
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  matchedOn: Array<"name" | "email">;
};

function duplicatesOf(result: unknown): Duplicate[] | undefined {
  if (result instanceof Response) return undefined;
  return (result as { data?: { duplicates?: Duplicate[] } }).data?.duplicates;
}

type PersonFields = { firstName: string; lastName: string; email?: string };

/** Post the new-person form; `extra` carries e.g. the "save anyway" confirmation. */
function saveNewPerson(
  w: Workspace,
  cookie: string,
  person: PersonFields,
  extra: Record<string, string | string[]> = {},
) {
  return run(() =>
    personEditorAction({
      request: post(w, cookie, "people/new", { ...personContactFields(), ...person, ...extra }),
      params: { tenant: w.slug },
      context: {},
    }),
  );
}

function publishedPerson(w: Workspace, person: PersonFields) {
  return prisma.person.create({ data: { tenantId: w.tenantId, ...person } });
}

function openPersonChanges(w: Workspace) {
  return prisma.changeRequest.findMany({
    where: { tenantId: w.tenantId, entityType: "PERSON", status: { in: ["DRAFT", "PENDING"] } },
  });
}

async function submitAllDrafts(w: Workspace, author: Actor) {
  const drafts = await prisma.changeRequest.findMany({
    where: { tenantId: w.tenantId, status: "DRAFT", submittedById: author.id },
  });
  await submitDraftsAction({
    request: post(w, author.cookie, "submissions/submit-drafts", {
      "ids[]": drafts.map((d) => d.id),
    }),
    params: { tenant: w.slug },
    context: {},
  });
  return drafts;
}

describe("possible duplicate people — saving", () => {
  it("warns instead of saving when the name matches a published person", async () => {
    const { home } = await arrange();
    const existing = await publishedPerson(home, { firstName: "Amina", lastName: "Diallo" });

    const result = await saveNewPerson(home, home.focal.cookie, {
      firstName: "Amina",
      lastName: "Diallo",
    });

    expect(statusOf(result)).not.toBe(302);
    expect(duplicatesOf(result)).toEqual([
      {
        source: "PERSON",
        id: existing.id,
        firstName: "Amina",
        lastName: "Diallo",
        email: null,
        matchedOn: ["name"],
      },
    ]);
    expect(await openPersonChanges(home)).toHaveLength(0);
  });

  it("matches names regardless of case, accents and extra whitespace", async () => {
    const { home } = await arrange();
    const existing = await publishedPerson(home, { firstName: "Amélie", lastName: "N'Diaye Koné" });

    const result = await saveNewPerson(home, home.focal.cookie, {
      firstName: "  AMELIE ",
      lastName: "n'diaye   kone",
    });

    expect(duplicatesOf(result)?.map((d) => d.id)).toEqual([existing.id]);
  });

  it("warns when only the email matches, ignoring case", async () => {
    const { home } = await arrange();
    const existing = await publishedPerson(home, {
      firstName: "Amina",
      lastName: "Diallo",
      email: "A.Diallo@au.int",
    });

    const result = await saveNewPerson(home, home.focal.cookie, {
      firstName: "Aminata",
      lastName: "D.",
      email: "a.diallo@AU.int",
    });

    expect(duplicatesOf(result)).toMatchObject([{ id: existing.id, matchedOn: ["email"] }]);
  });

  it("saves without a warning when nothing matches", async () => {
    const { home } = await arrange();
    await publishedPerson(home, { firstName: "Amina", lastName: "Diallo", email: "a@au.int" });

    const result = await saveNewPerson(home, home.focal.cookie, {
      firstName: "Kwame",
      lastName: "Mensah",
      email: "k@au.int",
    });

    expect(statusOf(result)).toBe(302);
    expect(duplicatesOf(result)).toBeUndefined();
    expect(await openPersonChanges(home)).toHaveLength(1);
  });

  it("lets the user continue past the warning", async () => {
    const { home } = await arrange();
    await publishedPerson(home, { firstName: "Amina", lastName: "Diallo" });

    const result = await saveNewPerson(
      home,
      home.focal.cookie,
      { firstName: "Amina", lastName: "Diallo" },
      { confirmDuplicates: "1" },
    );

    expect(statusOf(result)).toBe(302);
    expect(await openPersonChanges(home)).toHaveLength(1);
  });

  it("warns a manager too, and publishes once they continue", async () => {
    const { home } = await arrange();
    await publishedPerson(home, { firstName: "Amina", lastName: "Diallo" });
    const person = { firstName: "Amina", lastName: "Diallo" };

    const warned = await saveNewPerson(home, home.manager.cookie, person);
    expect(duplicatesOf(warned)).toHaveLength(1);
    expect(await prisma.person.count({ where: { tenantId: home.tenantId } })).toBe(1);

    const saved = await saveNewPerson(home, home.manager.cookie, person, {
      confirmDuplicates: "1",
    });
    expect(statusOf(saved)).toBe(302);
    expect(await prisma.person.count({ where: { tenantId: home.tenantId } })).toBe(2);
  });

  it("matches another user's draft, and their request once it is pending", async () => {
    const { home } = await arrange();
    const person = { firstName: "Amina", lastName: "Diallo" };
    await saveNewPerson(home, home.otherFocal.cookie, person);

    const againstDraft = await saveNewPerson(home, home.focal.cookie, person);
    expect(duplicatesOf(againstDraft)).toMatchObject([
      { source: "DRAFT", firstName: "Amina", lastName: "Diallo", matchedOn: ["name"] },
    ]);

    const [submitted] = await submitAllDrafts(home, home.otherFocal);
    const againstPending = await saveNewPerson(home, home.focal.cookie, person);
    expect(duplicatesOf(againstPending)).toMatchObject([{ source: "PENDING", id: submitted.id }]);
  });

  it("ignores rejected and withdrawn requests", async () => {
    const { home } = await arrange();
    const person = { firstName: "Amina", lastName: "Diallo" };
    await saveNewPerson(home, home.otherFocal.cookie, person);
    const [submitted] = await submitAllDrafts(home, home.otherFocal);
    await prisma.changeRequest.update({
      where: { id: submitted.id },
      data: { status: "REJECTED" },
    });

    const result = await saveNewPerson(home, home.focal.cookie, person);

    expect(statusOf(result)).toBe(302);
  });

  it("never shows a person, draft or request from another tenant", async () => {
    const { home, other } = await arrange();
    const person = { firstName: "Amina", lastName: "Diallo", email: "a.diallo@au.int" };
    await publishedPerson(other, person);
    await saveNewPerson(other, other.focal.cookie, { ...person, email: "" }, {});
    await saveNewPerson(other, other.otherFocal.cookie, {
      firstName: "X",
      lastName: "Y",
      email: person.email,
    });
    await submitAllDrafts(other, other.otherFocal);

    const result = await saveNewPerson(home, home.focal.cookie, person);

    expect(duplicatesOf(result)).toBeUndefined();
    expect(statusOf(result)).toBe(302);
  });

  it("does not warn about the person being edited", async () => {
    const { home } = await arrange();
    const existing = await publishedPerson(home, {
      firstName: "Amina",
      lastName: "Diallo",
      email: "a.diallo@au.int",
    });

    const result = await run(() =>
      personEditorAction({
        request: post(home, home.focal.cookie, `people/${existing.id}/edit`, {
          ...personContactFields(),
          id: existing.id,
          baseVersion: String(existing.version),
          firstName: "Amina",
          lastName: "Diallo",
          email: "a.diallo@au.int",
          phone: "+251 11 000 0000",
        }),
        params: { tenant: home.slug, personId: existing.id },
        context: {},
      }),
    );

    expect(duplicatesOf(result)).toBeUndefined();
    expect(statusOf(result)).toBe(302);
  });

  it("does not warn about the draft being re-saved", async () => {
    const { home } = await arrange();
    const person = { firstName: "Amina", lastName: "Diallo" };
    await saveNewPerson(home, home.focal.cookie, person);
    const [draft] = await openPersonChanges(home);

    const result = await run(() =>
      personEditorAction({
        request: post(home, home.focal.cookie, `people/new?draft=${draft.id}`, {
          ...personContactFields(),
          ...person,
          phone: "+251 11 000 0000",
        }),
        params: { tenant: home.slug },
        context: {},
      }),
    );

    expect(duplicatesOf(result)).toBeUndefined();
    expect(statusOf(result)).toBe(302);
    expect(await openPersonChanges(home)).toHaveLength(1);
  });
});

describe("possible duplicate people — change detail page", () => {
  async function loadDetail(w: Workspace, cookie: string, changeId: string) {
    const result = await run(() =>
      changeDetailLoader({
        request: new Request(`http://localhost/${w.slug}/approvals/${changeId}`, {
          headers: { cookie },
        }),
        params: { tenant: w.slug, changeId },
        context: {},
      } as Parameters<typeof changeDetailLoader>[0]),
    );
    return (result as { data: { possibleDuplicates: Duplicate[] } }).data.possibleDuplicates;
  }

  it("shows the manager the possible duplicates of a pending new person", async () => {
    const { home, other } = await arrange();
    const person = { firstName: "Amina", lastName: "Diallo" };
    const existing = await publishedPerson(home, person);
    await publishedPerson(other, person);
    await saveNewPerson(home, home.focal.cookie, person, { confirmDuplicates: "1" });
    const [submitted] = await submitAllDrafts(home, home.focal);

    const duplicates = await loadDetail(home, home.manager.cookie, submitted.id);

    expect(duplicates).toMatchObject([{ source: "PERSON", id: existing.id, matchedOn: ["name"] }]);
  });

  it("shows nothing when the pending person matches no one", async () => {
    const { home } = await arrange();
    await publishedPerson(home, { firstName: "Kwame", lastName: "Mensah" });
    await saveNewPerson(home, home.focal.cookie, { firstName: "Amina", lastName: "Diallo" });
    const [submitted] = await submitAllDrafts(home, home.focal);

    expect(await loadDetail(home, home.manager.cookie, submitted.id)).toEqual([]);
  });
});

describe("person languages", () => {
  it("saves the languages ticked on the form to the person", async () => {
    const { home } = await arrange();

    const result = await saveNewPerson(
      home,
      home.manager.cookie,
      { firstName: "Kofi", lastName: "Mensah" },
      { languages: ["en", "fr", "en"] },
    );

    expect(statusOf(result)).toBe(302);
    const person = await prisma.person.findFirstOrThrow({
      where: { tenantId: home.tenantId, lastName: "Mensah" },
    });
    expect(person.languages).toEqual(["en", "fr"]);
  });

  it("refuses a language the form does not offer", async () => {
    const { home } = await arrange();

    const result = await saveNewPerson(
      home,
      home.focal.cookie,
      { firstName: "Kofi", lastName: "Mensah" },
      { languages: ["xx"] },
    );

    expect(statusOf(result)).toBe(400);
    expect(await openPersonChanges(home)).toHaveLength(0);
  });
});
