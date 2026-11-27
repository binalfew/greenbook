import { hash } from "bcryptjs";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTenant, seedActiveUserStatus } from "../factories";
import { prisma } from "../setup/integration-setup";

import { loader as publicPhotoLoader } from "~/routes/_public/people/$personId_.photo";
import { action as approveAction } from "~/routes/$tenant/_directory/approvals/$changeId.approve";
import { action as discardAction } from "~/routes/$tenant/_directory/approvals/$changeId.discard";
import { loader as changeDetailLoader } from "~/routes/$tenant/_directory/approvals/$changeId._layout";
import { action as rejectAction } from "~/routes/$tenant/_directory/approvals/$changeId.reject";
import { action as reopenAction } from "~/routes/$tenant/_directory/approvals/$changeId.reopen";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/approvals/submit-drafts";
import { action as personEditorAction } from "~/routes/$tenant/_directory/people/+shared/person-editor.server";
import { loader as editPersonLoader } from "~/routes/$tenant/_directory/people/$personId_/edit";
import { loader as tenantPhotoLoader } from "~/routes/$tenant/_directory/photos.$photoId";
import { clearPublicTenantIdsCache } from "~/services/public-directory.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { createSessionCookie } from "./helpers/session";

beforeEach(() => {
  clearFlagCache();
  clearPublicTenantIdsCache();
});

type Actor = { id: string; cookie: string };
type Seeded = {
  tenantId: string;
  slug: string;
  focal: Actor;
  otherFocal: Actor;
  manager: Actor;
  /** A plain directory reader with no role in the tenant. */
  reader: Actor;
};

async function arrange(): Promise<Seeded> {
  const status = await seedActiveUserStatus(prisma);
  const tenant = await prisma.tenant.create({ data: buildTenant() });
  const passwordHash = await hash("test-password", 4);

  const focalRole = await prisma.role.create({ data: { name: "focal", scope: "TENANT" } });
  const managerRole = await prisma.role.create({ data: { name: "manager", scope: "TENANT" } });

  async function grant(roleId: string, resource: string, action: string) {
    const perm = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      create: { resource, action, module: "directory" },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId: perm.id, access: "any" } });
  }

  await grant(focalRole.id, "person", "read");
  await grant(focalRole.id, "directory-change", "submit");
  await grant(focalRole.id, "directory-change", "read-own");
  await grant(focalRole.id, "directory-change", "withdraw-own");

  await grant(managerRole.id, "person", "read");
  await grant(managerRole.id, "person", "write");
  await grant(managerRole.id, "person", "delete");
  await grant(managerRole.id, "directory-change", "approve");
  await grant(managerRole.id, "directory-change", "reject");
  await grant(managerRole.id, "directory-change", "read-all");

  async function user(name: string, tenantId: string | null, roleId?: string): Promise<Actor> {
    const created = await prisma.user.create({
      data: {
        email: `${name}-${tenant.id}@test.com`,
        firstName: name,
        lastName: "Tester",
        tenantId,
        userStatusId: status.id,
        password: { create: { hash: passwordHash } },
        ...(roleId ? { userRoles: { create: { roleId } } } : {}),
      },
    });
    return { id: created.id, cookie: await createSessionCookie(prisma, created.id) };
  }

  for (const key of ["FF_DIRECTORY", "FF_PUBLIC_DIRECTORY"]) {
    await prisma.featureFlag.create({
      data: { key, scope: "tenant", enabled: false, enabledForTenants: [tenant.id] },
    });
  }

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    focal: await user("focal", tenant.id, focalRole.id),
    otherFocal: await user("other-focal", tenant.id, focalRole.id),
    manager: await user("manager", tenant.id, managerRole.id),
    reader: await user("reader", null),
  };
}

// ─── Files ──────────────────────────────────────────────────────────────

function picture(width: number, height: number, colour: string) {
  return sharp({ create: { width, height, channels: 3, background: colour } });
}

/** A large JPEG carrying EXIF metadata, as a camera would produce. */
async function cameraJpeg(colour = "#cc0000"): Promise<File> {
  const bytes = await picture(1600, 1200, colour)
    .withExif({ IFD0: { Copyright: "Original Photographer", Make: "TestCam" } })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(bytes)], "portrait.jpg", { type: "image/jpeg" });
}

// ─── Requests ───────────────────────────────────────────────────────────

function get(a: Seeded, cookie: string | null, path: string): Request {
  return new Request(`http://localhost/${path}`, { headers: cookie ? { cookie } : {} });
}

function post(a: Seeded, cookie: string, path: string, body: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  return new Request(`http://localhost/${a.slug}/${path}`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
}

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
  return (result as { init?: { status?: number } | null } | null)?.init?.status;
}

function payloadOf<T>(result: unknown): T {
  return (result as { data: T }).data;
}

function personForm(name: string, extra: Record<string, string | File> = {}) {
  return { firstName: name, lastName: "Photo", ...extra };
}

async function savePerson(
  a: Seeded,
  cookie: string,
  body: Record<string, string | File>,
  options: { personId?: string; draftId?: string } = {},
) {
  const path = options.personId ? `people/${options.personId}/edit` : "people/new";
  const query = options.draftId ? `?draft=${options.draftId}` : "";
  return run(() =>
    personEditorAction({
      request: post(a, cookie, `${path}${query}`, body),
      params: { tenant: a.slug, ...(options.personId ? { personId: options.personId } : {}) },
      context: {},
    }),
  );
}

async function tenantPhoto(a: Seeded, cookie: string | null, photoId: string) {
  return (await run(() =>
    tenantPhotoLoader({
      request: get(a, cookie, `${a.slug}/photos/${photoId}`),
      params: { tenant: a.slug, photoId },
      context: {},
    } as never),
  )) as Response;
}

async function directoryPhoto(a: Seeded, cookie: string | null, personId: string) {
  return (await run(() =>
    publicPhotoLoader({
      request: get(a, cookie, `people/${personId}/photo`),
      params: { personId },
      context: {},
    } as never),
  )) as Response;
}

async function onlyDraft(a: Seeded) {
  return prisma.changeRequest.findFirstOrThrow({
    where: { tenantId: a.tenantId, status: "DRAFT" },
  });
}

async function submit(a: Seeded, cookie: string, changeId: string) {
  const form = new URLSearchParams({ "ids[]": changeId });
  await run(() =>
    submitDraftsAction({
      request: new Request(`http://localhost/${a.slug}/approvals/submit-drafts`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: form.toString(),
      }),
      params: { tenant: a.slug },
      context: {},
    } as never),
  );
}

async function review(
  a: Seeded,
  action: typeof approveAction | typeof rejectAction | typeof discardAction | typeof reopenAction,
  verb: string,
  cookie: string,
  changeId: string,
) {
  const result = await run(() =>
    action({
      request: post(a, cookie, `approvals/${changeId}/${verb}`, { notes: "Reviewed" }),
      params: { tenant: a.slug, changeId },
      context: {},
    } as never),
  );
  expect(statusOf(result)).toBe(302);
}

async function photoIdOf(change: { payload: unknown }) {
  return (change.payload as { photoId?: string | null }).photoId ?? null;
}

/** A person published by the manager with a photo; returns the fresh row. */
async function publishedPersonWithPhoto(a: Seeded, name: string) {
  const result = await savePerson(
    a,
    a.manager.cookie,
    personForm(name, { photo: await cameraJpeg() }),
  );
  expect(statusOf(result)).toBe(302);
  const person = await prisma.person.findFirstOrThrow({
    where: { tenantId: a.tenantId, firstName: name },
  });
  expect(person.photoId).toBeTruthy();
  return { ...person, photoId: person.photoId! };
}

function editForm(person: { id: string; firstName: string; version: number; photoId: string }) {
  return personForm(person.firstName, {
    id: person.id,
    baseVersion: String(person.version),
    photoId: person.photoId,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("person photo: upload", () => {
  it("a manager's upload is published resized, re-encoded and without the original metadata", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Amina");

    const response = await tenantPhoto(a, a.manager.cookie, person.photoId);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toMatch(/^private\b/);

    const served = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(served).metadata();
    expect(response.headers.get("Content-Type")).toBe(`image/${meta.format}`);
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
    expect(meta.exif).toBeUndefined();
    expect(served.includes("Original Photographer")).toBe(false);
    expect(served.byteLength).toBeLessThan(100 * 1024);
  });

  it("decides the type from the content, not the name or the declared type", async () => {
    const a = await arrange();
    const png = await picture(300, 200, "#00aa00").png().toBuffer();
    const disguised = new File([new Uint8Array(png)], "notes.txt", { type: "text/plain" });

    const result = await savePerson(a, a.manager.cookie, personForm("Bola", { photo: disguised }));

    expect(statusOf(result)).toBe(302);
    const person = await prisma.person.findFirstOrThrow({ where: { firstName: "Bola" } });
    expect(person.photoId).toBeTruthy();
  });

  it.each([
    [
      "text with an image name and type",
      async () => new File(["just some text"], "photo.jpg", { type: "image/jpeg" }),
    ],
    [
      "a GIF",
      async () =>
        new File([new Uint8Array(await picture(50, 50, "#0000aa").gif().toBuffer())], "photo.png", {
          type: "image/png",
        }),
    ],
    [
      "a file over the upload limit",
      async () => {
        const jpeg = await picture(50, 50, "#0000aa").jpeg().toBuffer();
        return new File([new Uint8Array(jpeg), new Uint8Array(6 * 1024 * 1024)], "big.jpg", {
          type: "image/jpeg",
        });
      },
    ],
  ])("rejects %s with an error on the photo field", async (_label, makeFile) => {
    const a = await arrange();

    const result = await savePerson(
      a,
      a.manager.cookie,
      personForm("Chidi", { photo: await makeFile() }),
    );

    expect(statusOf(result)).toBe(400);
    const reply = payloadOf<{ error?: Record<string, string[] | null> }>(result);
    expect(reply.error?.photo?.[0]).toBeTruthy();
    expect(await prisma.person.count()).toBe(0);
    expect(await prisma.personPhoto.count()).toBe(0);
    expect(await prisma.changeRequest.count()).toBe(0);
  });
});

describe("person photo: upload with a possible duplicate", () => {
  it("reports a bad photo on the first save, before the duplicate warning", async () => {
    const a = await arrange();
    await savePerson(a, a.manager.cookie, personForm("Dayo"));
    const text = new File(["just some text"], "photo.jpg", { type: "image/jpeg" });

    const result = await savePerson(a, a.manager.cookie, personForm("Dayo", { photo: text }));

    expect(statusOf(result)).toBe(400);
    const reply = payloadOf<{ error?: Record<string, string[] | null> }>(result);
    expect(reply.error?.photo?.[0]).toBeTruthy();
  });

  it("stores nothing while the duplicate warning is showing", async () => {
    const a = await arrange();
    await savePerson(a, a.manager.cookie, personForm("Efua"));

    const result = await savePerson(
      a,
      a.manager.cookie,
      personForm("Efua", { photo: await cameraJpeg() }),
    );

    expect(payloadOf<{ duplicates?: unknown[] }>(result).duplicates).toHaveLength(1);
    expect(await prisma.personPhoto.count()).toBe(0);
  });
});

describe("person photo: who can see it", () => {
  it("refuses an unauthenticated request on both routes", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Dalia");

    for (const response of [
      await tenantPhoto(a, null, person.photoId),
      await directoryPhoto(a, null, person.id),
    ]) {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toMatch(/^\/login/);
    }
  });

  it("serves a published photo to any logged-in user of the cross-tenant directory", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Efua");

    const response = await directoryPhoto(a, a.reader.cookie, person.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toMatch(/^private\b/);
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(400);
  });

  it("keeps a focal person's photo to its author until submitted, then shows the manager a before and after", async () => {
    const a = await arrange();
    const result = await savePerson(
      a,
      a.focal.cookie,
      personForm("Farah", { photo: await cameraJpeg() }),
    );
    expect(statusOf(result)).toBe(302);
    const draft = await onlyDraft(a);
    const photoId = (await photoIdOf(draft))!;
    expect(photoId).toBeTruthy();
    expect(await prisma.person.count()).toBe(0);

    expect((await tenantPhoto(a, a.focal.cookie, photoId)).status).toBe(200);
    expect((await tenantPhoto(a, a.otherFocal.cookie, photoId)).status).toBe(404);
    expect((await tenantPhoto(a, a.manager.cookie, photoId)).status).toBe(404);

    await submit(a, a.focal.cookie, draft.id);

    expect((await tenantPhoto(a, a.manager.cookie, photoId)).status).toBe(200);
    expect((await tenantPhoto(a, a.otherFocal.cookie, photoId)).status).toBe(404);
    const detail = await changeDetailLoader({
      request: get(a, a.manager.cookie, `${a.slug}/approvals/${draft.id}`),
      params: { tenant: a.slug, changeId: draft.id },
      context: {},
    } as never);
    const diffs = payloadOf<{ diffs: { field: string; before: unknown; after: unknown }[] }>(
      detail,
    ).diffs;
    expect(diffs.find((d) => d.field === "photoId")).toEqual({
      field: "photoId",
      before: null,
      after: photoId,
    });
  });
});

describe("person photo: approval", () => {
  it("publishes a replacement only on approval and then drops the old photo", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Gugu");
    const before = Buffer.from(
      await (await directoryPhoto(a, a.reader.cookie, person.id)).arrayBuffer(),
    );

    const saved = await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), photo: await cameraJpeg("#0000cc") },
      { personId: person.id },
    );
    expect(statusOf(saved)).toBe(302);
    const draft = await onlyDraft(a);
    const newPhotoId = (await photoIdOf(draft))!;
    expect(newPhotoId).not.toBe(person.photoId);
    await submit(a, a.focal.cookie, draft.id);

    // Still the old picture for everyone else.
    const during = Buffer.from(
      await (await directoryPhoto(a, a.reader.cookie, person.id)).arrayBuffer(),
    );
    expect(during.equals(before)).toBe(true);
    const detail = await changeDetailLoader({
      request: get(a, a.manager.cookie, `${a.slug}/approvals/${draft.id}`),
      params: { tenant: a.slug, changeId: draft.id },
      context: {},
    } as never);
    expect(
      payloadOf<{ diffs: { field: string }[] }>(detail).diffs.find((d) => d.field === "photoId"),
    ).toEqual({ field: "photoId", before: person.photoId, after: newPhotoId });

    await review(a, approveAction, "approve", a.manager.cookie, draft.id);

    const after = Buffer.from(
      await (await directoryPhoto(a, a.reader.cookie, person.id)).arrayBuffer(),
    );
    expect(after.equals(before)).toBe(false);
    expect((await prisma.personPhoto.findMany()).map((p) => p.id)).toEqual([newPhotoId]);
  });

  it("an edit that does not touch the photo keeps it and shows no photo change", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Hana");

    const saved = await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), bio: "New biography" },
      { personId: person.id },
    );
    expect(statusOf(saved)).toBe(302);
    const draft = await onlyDraft(a);
    await submit(a, a.focal.cookie, draft.id);
    await review(a, approveAction, "approve", a.manager.cookie, draft.id);

    const updated = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(updated.bio).toBe("New biography");
    expect(updated.photoId).toBe(person.photoId);
    expect((await directoryPhoto(a, a.reader.cookie, person.id)).status).toBe(200);
  });

  it("removing a photo takes effect only on approval", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Imani");

    const saved = await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), removePhoto: "1" },
      { personId: person.id },
    );
    expect(statusOf(saved)).toBe(302);
    const draft = await onlyDraft(a);
    expect(await photoIdOf(draft)).toBeNull();
    await submit(a, a.focal.cookie, draft.id);
    expect((await directoryPhoto(a, a.reader.cookie, person.id)).status).toBe(200);

    await review(a, approveAction, "approve", a.manager.cookie, draft.id);

    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).photoId,
    ).toBeNull();
    expect((await directoryPhoto(a, a.reader.cookie, person.id)).status).toBe(404);
    expect(await prisma.personPhoto.count()).toBe(0);
  });

  it("does not let a form point a person at a photo the author may not use", async () => {
    const a = await arrange();
    const victim = await publishedPersonWithPhoto(a, "Jomo");

    const saved = await savePerson(
      a,
      a.focal.cookie,
      personForm("Kofi", { photoId: victim.photoId }),
    );

    expect(statusOf(saved)).toBe(302);
    expect(await photoIdOf(await onlyDraft(a))).toBeNull();
  });
});

describe("person photo: cleanup", () => {
  it("discarding a draft deletes its photo", async () => {
    const a = await arrange();
    await savePerson(a, a.focal.cookie, personForm("Lina", { photo: await cameraJpeg() }));
    const draft = await onlyDraft(a);
    expect(await prisma.personPhoto.count()).toBe(1);

    await review(a, discardAction, "discard", a.focal.cookie, draft.id);

    expect(await prisma.personPhoto.count()).toBe(0);
  });

  it("replacing the photo in a draft deletes the photo it replaced", async () => {
    const a = await arrange();
    await savePerson(a, a.focal.cookie, personForm("Nia", { photo: await cameraJpeg() }));
    const draft = await onlyDraft(a);
    const firstPhotoId = (await photoIdOf(draft))!;

    const resaved = await savePerson(
      a,
      a.focal.cookie,
      personForm("Nia", { photoId: firstPhotoId, photo: await cameraJpeg("#00cccc") }),
      { draftId: draft.id },
    );

    expect(statusOf(resaved)).toBe(302);
    const secondPhotoId = await photoIdOf(await onlyDraft(a));
    expect(secondPhotoId).not.toBe(firstPhotoId);
    expect((await prisma.personPhoto.findMany()).map((p) => p.id)).toEqual([secondPhotoId]);
  });

  it("the editor resumes a draft with the photo it was saved with", async () => {
    const a = await arrange();
    const person = await publishedPersonWithPhoto(a, "Oba");
    await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), photo: await cameraJpeg("#cc00cc") },
      { personId: person.id },
    );
    const draft = await onlyDraft(a);

    const loaded = await editPersonLoader({
      request: get(a, a.focal.cookie, `${a.slug}/people/${person.id}/edit?draft=${draft.id}`),
      params: { tenant: a.slug, personId: person.id },
      context: {},
    } as never);

    const { draft: resumed } = payloadOf<{ draft: { values: Record<string, unknown> } }>(loaded);
    expect(resumed.values.photoId).toBe(await photoIdOf(draft));
  });
});

// A rejected request can be reopened as a draft, so the photo it proposed has
// to outlive the rejection.
describe("person photo: rejected and reopened", () => {
  /** A published person, and a focal person's rejected request to replace the photo. */
  async function rejectedReplacement(a: Seeded, name: string) {
    const person = await publishedPersonWithPhoto(a, name);
    await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), photo: await cameraJpeg("#00cc00") },
      { personId: person.id },
    );
    const rejected = await onlyDraft(a);
    await submit(a, a.focal.cookie, rejected.id);
    await review(a, rejectAction, "reject", a.manager.cookie, rejected.id);
    return { person, rejected, proposedPhotoId: (await photoIdOf(rejected))! };
  }

  const photoIds = async () => (await prisma.personPhoto.findMany()).map((p) => p.id).sort();

  it("a reopened draft shows the proposed photo and publishes it when approved", async () => {
    const a = await arrange();
    const { person, rejected, proposedPhotoId } = await rejectedReplacement(a, "Musa");

    await review(a, reopenAction, "reopen", a.focal.cookie, rejected.id);

    const draft = await onlyDraft(a);
    expect(await photoIdOf(draft)).toBe(proposedPhotoId);
    expect((await tenantPhoto(a, a.focal.cookie, proposedPhotoId)).status).toBe(200);

    // Saved again without touching the photo, as the editor would post it.
    const resaved = await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), photoId: proposedPhotoId },
      { personId: person.id, draftId: draft.id },
    );
    expect(statusOf(resaved)).toBe(302);
    await submit(a, a.focal.cookie, draft.id);
    await review(a, approveAction, "approve", a.manager.cookie, draft.id);

    const published = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(published.photoId).toBe(proposedPhotoId);
    expect(await photoIds()).toEqual([proposedPhotoId]);
  });

  it("discarding the reopened draft deletes the proposed photo", async () => {
    const a = await arrange();
    const { person, rejected } = await rejectedReplacement(a, "Nala");
    await review(a, reopenAction, "reopen", a.focal.cookie, rejected.id);

    await review(a, discardAction, "discard", a.focal.cookie, (await onlyDraft(a)).id);

    expect(await photoIds()).toEqual([person.photoId]);
  });

  it("reopening again after that gives a draft that leaves the photo alone", async () => {
    const a = await arrange();
    const { person, rejected } = await rejectedReplacement(a, "Omar");
    await review(a, reopenAction, "reopen", a.focal.cookie, rejected.id);
    await review(a, discardAction, "discard", a.focal.cookie, (await onlyDraft(a)).id);

    await review(a, reopenAction, "reopen", a.focal.cookie, rejected.id);

    const draft = await onlyDraft(a);
    expect(await photoIdOf(draft)).toBeNull();
    await submit(a, a.focal.cookie, draft.id);
    await review(a, approveAction, "approve", a.manager.cookie, draft.id);
    const published = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(published.photoId).toBe(person.photoId);
  });

  it("approving a follow-up with a different photo deletes the one first proposed", async () => {
    const a = await arrange();
    const { person, rejected, proposedPhotoId } = await rejectedReplacement(a, "Pita");
    await review(a, reopenAction, "reopen", a.focal.cookie, rejected.id);
    const draft = await onlyDraft(a);
    await savePerson(
      a,
      a.focal.cookie,
      { ...editForm(person), photoId: proposedPhotoId, photo: await cameraJpeg("#0000cc") },
      { personId: person.id, draftId: draft.id },
    );
    const finalPhotoId = (await photoIdOf(await onlyDraft(a)))!;
    expect(finalPhotoId).not.toBe(proposedPhotoId);

    await submit(a, a.focal.cookie, draft.id);
    await review(a, approveAction, "approve", a.manager.cookie, draft.id);

    expect(await photoIds()).toEqual([finalPhotoId]);
  });
});
