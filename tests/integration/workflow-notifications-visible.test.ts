import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, buildUser, seedActiveUserStatus, seedNewTenantFlags } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as tenantLayoutLoader } from "~/routes/$tenant/_layout";
import { loader as changeDetailLoader } from "~/routes/$tenant/_directory/approvals/$changeId._layout";
import { loader as submissionDetailLoader } from "~/routes/$tenant/_directory/submissions/$changeId._layout";
import { action as approveAction } from "~/routes/$tenant/_directory/approvals/$changeId.approve";
import { action as rejectAction } from "~/routes/$tenant/_directory/approvals/$changeId.reject";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/submissions/submit-drafts";
import { action as personEditorAction } from "~/routes/$tenant/_directory/people/+shared/person-editor.server";
import { loader as openNotificationLoader } from "~/routes/$tenant/notifications/$notificationId.open";
import { loader as inboxLoader } from "~/routes/$tenant/notifications/index";
import { action as markAllReadAction } from "~/routes/$tenant/notifications/mark-all-read";
import { action as newTenantAction } from "~/routes/$tenant/tenants/new";
import { clearPublicTenantIdsCache } from "~/services/public-directory.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { grantPermissions, personForm } from "./helpers/directory-actors";
import { get, post, run, statusOf } from "./helpers/requests";
import { createSessionCookie } from "./helpers/session";

// The workflow's notifications are addressed to managers and focal persons,
// so those are the people who must see the bell and the inbox, in a tenant
// created through the UI as much as in a seeded one, and be able to open
// what a notification is about.

const SLUG = "medical";

beforeEach(() => {
  clearFlagCache();
  clearPublicTenantIdsCache();
});

/**
 * A tenant created through the form the global admin uses, with one manager
 * and one focal person placed in it.
 */
async function arrange() {
  const status = await seedActiveUserStatus(prisma);
  const system = await prisma.tenant.create({ data: buildTenant({ slug: "system" }) });
  const adminRole = await prisma.role.create({ data: { name: "admin", scope: "GLOBAL" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });
  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  await prisma.role.create({ data: { name: "user", scope: "GLOBAL" } });
  await grantPermissions(prisma, focalRole.id, [
    ["person", "read"],
    ["directory-change", "submit"],
    ["directory-change", "read-own"],
  ]);
  await grantPermissions(prisma, managerRole.id, [
    ["person", "read"],
    ["person", "write"],
    ["directory-change", "read-all"],
    ["directory-change", "approve"],
    ["directory-change", "reject"],
  ]);
  await seedNewTenantFlags(prisma);

  const admin = await prisma.user.create({
    data: {
      ...buildUser({ tenantId: system.id, userStatusId: status.id }),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  const adminCookie = await createSessionCookie(prisma, admin.id);

  const created = await run(async () =>
    newTenantAction({
      request: await post("/system/tenants/new", adminCookie, {
        name: "Medical Services",
        slug: SLUG,
        email: "medical@example.org",
        phone: "+251 11 000 0000",
      }),
      params: { tenant: "system" },
      context: {},
    } as never),
  );
  expect(statusOf(created)).toBe(302);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: SLUG } });

  const member = async (roleId: string, firstName: string, lastName: string) => {
    const user = await prisma.user.create({
      data: {
        ...buildUser({ tenantId: tenant.id, userStatusId: status.id }),
        firstName,
        lastName,
        userRoles: { create: { roleId } },
      },
    });
    return { id: user.id, cookie: await createSessionCookie(prisma, user.id) };
  };
  const orgType = await prisma.organizationType.create({
    data: { code: "ROOT", name: "Root", level: 0 },
  });

  return {
    tenant,
    orgTypeId: orgType.id,
    manager: await member(managerRole.id, "Musa", "Manager"),
    focal: await member(focalRole.id, "Fatou", "Focal"),
  };
}

type Arranged = Awaited<ReturnType<typeof arrange>>;
type Listed = { id: string; type: string; title: string; read: boolean };

/** What the bell shows this user: whether it is there, the count, the latest. */
async function bell(cookie: string) {
  const result = (await tenantLayoutLoader({
    request: get(`/${SLUG}`, cookie),
    params: { tenant: SLUG },
    context: {},
  } as never)) as unknown as {
    data: { notifications: { enabled: boolean; unreadCount: number; recent: Listed[] } };
  };
  return result.data.notifications;
}

/** The inbox page as this user gets it. */
async function inbox(cookie: string) {
  const result = await run(() =>
    inboxLoader({
      request: get(`/${SLUG}/notifications`, cookie),
      params: { tenant: SLUG },
      context: {},
    } as never),
  );
  const notifications =
    (result as { data?: { notifications: Listed[] } }).data?.notifications ?? [];
  return { status: statusOf(result), notifications };
}

/** Follow a notification the way a click on it does; returns where it leads. */
async function open(cookie: string, notificationId: string) {
  const result = await run(() =>
    openNotificationLoader({
      request: get(`/${SLUG}/notifications/${notificationId}/open`, cookie),
      params: { tenant: SLUG, notificationId },
      context: {},
    } as never),
  );
  expect(statusOf(result)).toBe(302);
  return (result as Response).headers.get("Location")!;
}

/** Load the page a notification led to: the author's submission or the reviewer's copy. */
async function changePage(cookie: string, path: string) {
  const changeId = path.split("/").pop()!;
  const loader = path.includes("/submissions/") ? submissionDetailLoader : changeDetailLoader;
  const result = await run(() =>
    loader({
      request: get(path, cookie),
      params: { tenant: SLUG, changeId },
      context: {},
    } as never),
  );
  return {
    status: statusOf(result),
    change: (result as { data?: { change: { id: string; status: string } } }).data?.change,
  };
}

/** The focal person saves one draft per name, then sends them all for review together. */
async function submitAsFocal(a: Arranged, names = ["Proposed Person"]): Promise<string[]> {
  for (const name of names) {
    await run(async () =>
      personEditorAction({
        request: await post(`/${SLUG}/people/new`, a.focal.cookie, personForm(name)),
        params: { tenant: SLUG },
        context: {},
      } as never),
    );
  }
  const drafts = await prisma.changeRequest.findMany({
    where: { tenantId: a.tenant.id, status: "DRAFT" },
  });
  expect(drafts).toHaveLength(names.length);
  const body = new URLSearchParams(drafts.map((d) => ["ids[]", d.id]));
  await run(() =>
    submitDraftsAction({
      request: new Request(`http://localhost/${SLUG}/submissions/submit-drafts`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: a.focal.cookie,
        },
        body: body.toString(),
      }),
      params: { tenant: SLUG },
      context: {},
    } as never),
  );
  return drafts.map((d) => d.id);
}

async function decide(a: Arranged, changeId: string, verb: "approve" | "reject") {
  const action = verb === "approve" ? approveAction : rejectAction;
  const body: Record<string, string> = verb === "reject" ? { notes: "Already registered" } : {};
  const result = await run(async () =>
    action({
      request: await post(`/${SLUG}/approvals/${changeId}/${verb}`, a.manager.cookie, body),
      params: { tenant: SLUG, changeId },
      context: {},
    } as never),
  );
  expect(statusOf(result)).toBe(302);
}

describe("in a tenant created through the UI", () => {
  it("shows the bell and the inbox to a manager and to a focal person", async () => {
    const a = await arrange();

    for (const user of [a.manager, a.focal]) {
      expect((await bell(user.cookie)).enabled).toBe(true);
      expect((await inbox(user.cookie)).status).toBe(200);
    }
  });

  it("a submission reaches the manager, who can open the change from it", async () => {
    const a = await arrange();
    const [changeId] = await submitAsFocal(a);

    const shown = await bell(a.manager.cookie);
    expect(shown.unreadCount).toBe(1);
    expect(shown.recent).toHaveLength(1);
    expect(shown.recent[0]).toMatchObject({ type: "directory.change.submitted", read: false });

    const destination = await open(a.manager.cookie, shown.recent[0].id);
    expect(destination).toBe(`/${SLUG}/approvals/${changeId}`);
    expect(await changePage(a.manager.cookie, destination)).toMatchObject({
      status: 200,
      change: { id: changeId, status: "PENDING" },
    });
    expect((await bell(a.manager.cookie)).unreadCount).toBe(0);
  });

  it("a submission of several changes opens the manager's approval queue", async () => {
    const a = await arrange();
    await submitAsFocal(a, ["First Office", "Second Office"]);

    const shown = await bell(a.manager.cookie);
    expect(shown.unreadCount).toBe(1);

    expect(await open(a.manager.cookie, shown.recent[0].id)).toBe(`/${SLUG}/approvals`);
  });

  it("an approval reaches the focal person, who can open the change from it", async () => {
    const a = await arrange();
    const [changeId] = await submitAsFocal(a);
    await decide(a, changeId, "approve");

    const listed = (await inbox(a.focal.cookie)).notifications;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ type: "directory.change.approved", read: false });

    const destination = await open(a.focal.cookie, listed[0].id);
    expect(destination).toBe(`/${SLUG}/submissions/${changeId}`);
    expect(await changePage(a.focal.cookie, destination)).toMatchObject({
      status: 200,
      change: { id: changeId, status: "APPROVED" },
    });
    expect((await inbox(a.focal.cookie)).notifications[0].read).toBe(true);
  });

  it("a rejection reaches the focal person, who can open the change from it", async () => {
    const a = await arrange();
    const [changeId] = await submitAsFocal(a);
    await decide(a, changeId, "reject");

    const shown = await bell(a.focal.cookie);
    expect(shown.unreadCount).toBe(1);
    expect(shown.recent[0]).toMatchObject({ type: "directory.change.rejected" });

    const destination = await open(a.focal.cookie, shown.recent[0].id);
    expect(destination).toBe(`/${SLUG}/submissions/${changeId}`);
    expect(await changePage(a.focal.cookie, destination)).toMatchObject({
      status: 200,
      change: { id: changeId, status: "REJECTED" },
    });
  });

  it("keeps the inbox to the user's own tenant", async () => {
    const a = await arrange();
    const other = await prisma.tenant.create({ data: buildTenant() });
    const path = `/${other.slug}/notifications`;

    const page = await run(() =>
      inboxLoader({
        request: get(path, a.manager.cookie),
        params: { tenant: other.slug },
        context: {},
      } as never),
    );
    expect(statusOf(page)).toBe(403);

    const marked = await run(async () =>
      markAllReadAction({
        request: await post(`${path}/mark-all-read`, a.manager.cookie, {}),
        params: { tenant: other.slug },
        context: {},
      } as never),
    );
    expect(statusOf(marked)).toBe(403);
  });

  it("does not let one user open another user's notification", async () => {
    const a = await arrange();
    await submitAsFocal(a);
    const toManager = (await bell(a.manager.cookie)).recent[0];

    const result = await run(() =>
      openNotificationLoader({
        request: get(`/${SLUG}/notifications/${toManager.id}/open`, a.focal.cookie),
        params: { tenant: SLUG, notificationId: toManager.id },
        context: {},
      } as never),
    );

    expect(statusOf(result)).toBe(404);
    expect((await bell(a.manager.cookie)).unreadCount).toBe(1);
  });
});
