import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../setup/integration-setup";

import { action as approveAction } from "~/routes/$tenant/_directory/approvals/$changeId.approve";
import { action as discardAction } from "~/routes/$tenant/_directory/approvals/$changeId.discard";
import { action as rejectAction } from "~/routes/$tenant/_directory/approvals/$changeId.reject";
import { action as withdrawAction } from "~/routes/$tenant/_directory/approvals/$changeId.withdraw";
import { action as batchApproveAction } from "~/routes/$tenant/_directory/approvals/batch-approve";
import { action as batchRejectAction } from "~/routes/$tenant/_directory/approvals/batch-reject";
import { action as submitDraftsAction } from "~/routes/$tenant/_directory/approvals/submit-drafts";
import { action as organizationEditorAction } from "~/routes/$tenant/_directory/organogram/+shared/organization-editor.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { seedDirectoryActors, type DirectoryActors } from "./helpers/directory-actors";
import { payloadOf, post, routeArgs, run, statusOf, type FormBody } from "./helpers/requests";

// Every approvals dialog and batch action answers an ordinary conflict with a
// message in the user's language, never with a server error or the engine's
// own English text.

beforeEach(() => clearFlagCache());

const NOT_PENDING_EN =
  "This change is no longer waiting for review. Reload the page to see its current status.";
const NOT_PENDING_FR =
  "Cette modification n'est plus en attente de revue. Rechargez la page pour voir son statut actuel.";

const french = (cookie: string) => `${cookie}; i18n_lang=fr`;

type Action = (args: never) => Promise<unknown>;

async function act(
  a: DirectoryActors,
  action: Action,
  path: string,
  cookie: string,
  body: FormBody = {},
  params: Record<string, string> = {},
) {
  const request = await post(`/${a.slug}/${path}`, cookie, body);
  return run(() => action(routeArgs(request, { tenant: a.slug, ...params })));
}

const onChange = (
  a: DirectoryActors,
  action: Action,
  verb: string,
  cookie: string,
  changeId: string,
  body: FormBody = {},
) => act(a, action, `approvals/${changeId}/${verb}`, cookie, body, { changeId });

function orgForm(a: DirectoryActors, name: string, extra: Record<string, string> = {}) {
  return { name, typeId: a.orgTypeId, isActive: "true", sortOrder: "0", ...extra };
}

async function draftOrg(a: DirectoryActors, name: string) {
  await act(
    a,
    organizationEditorAction as Action,
    "organogram/new",
    a.focal.cookie,
    orgForm(a, name),
  );
  const drafts = await prisma.changeRequest.findMany({ where: { status: "DRAFT" } });
  return drafts.find((d) => (d.payload as { name?: string }).name === name)!;
}

async function pendingOrg(a: DirectoryActors, name: string) {
  const draft = await draftOrg(a, name);
  await act(a, submitDraftsAction as Action, "approvals/submit-drafts", a.focal.cookie, {
    "ids[]": [draft.id],
  });
  return draft;
}

/** A request the manager has already approved. */
async function approvedOrg(a: DirectoryActors, name: string) {
  const change = await pendingOrg(a, name);
  await onChange(a, approveAction as Action, "approve", a.manager.cookie, change.id);
  return change;
}

type BatchPayload = {
  error: string | null;
  result: {
    succeeded: { id: string }[];
    skipped: { id: string }[];
    failed: { id: string; code: string; message: string }[];
  } | null;
};

describe("approvals dialogs: a request that is no longer pending", () => {
  it("reject answers with a conflict message", async () => {
    const a = await seedDirectoryActors(prisma);
    const change = await approvedOrg(a, "Alpha");

    const result = await onChange(
      a,
      rejectAction as Action,
      "reject",
      a.manager.cookie,
      change.id,
      {
        notes: "Too late",
      },
    );

    expect(statusOf(result)).toBe(409);
    expect(JSON.stringify(payloadOf(result))).toContain(NOT_PENDING_EN);
  });

  it("reject answers in French when that is the user's language", async () => {
    const a = await seedDirectoryActors(prisma);
    const change = await approvedOrg(a, "Alpha");

    const result = await onChange(
      a,
      rejectAction as Action,
      "reject",
      french(a.manager.cookie),
      change.id,
      { notes: "Trop tard" },
    );

    expect(statusOf(result)).toBe(409);
    expect(JSON.stringify(payloadOf(result))).toContain(NOT_PENDING_FR);
  });

  it("withdraw answers with a conflict message", async () => {
    const a = await seedDirectoryActors(prisma);
    const change = await approvedOrg(a, "Alpha");

    const result = await onChange(
      a,
      withdrawAction as Action,
      "withdraw",
      french(a.focal.cookie),
      change.id,
    );

    expect(statusOf(result)).toBe(409);
    expect(payloadOf<{ error: string }>(result).error).toBe(NOT_PENDING_FR);
  });
});

describe("approvals dialogs: a request the user may not act on", () => {
  it("reject and approve answer 404 for a request that does not exist", async () => {
    const a = await seedDirectoryActors(prisma);

    const rejected = await onChange(a, rejectAction as Action, "reject", a.manager.cookie, "nope", {
      notes: "x",
    });
    const approved = await onChange(
      a,
      approveAction as Action,
      "approve",
      a.manager.cookie,
      "nope",
    );

    expect(statusOf(rejected)).toBe(404);
    expect(statusOf(approved)).toBe(404);
  });

  it("withdraw answers 403 for someone else's request and 404 for a missing one", async () => {
    const a = await seedDirectoryActors(prisma);
    const change = await pendingOrg(a, "Alpha");

    const others = await onChange(
      a,
      withdrawAction as Action,
      "withdraw",
      a.otherFocal.cookie,
      change.id,
    );
    const missing = await onChange(a, withdrawAction as Action, "withdraw", a.focal.cookie, "nope");

    expect(statusOf(others)).toBe(403);
    expect(statusOf(missing)).toBe(404);
  });

  it("discard answers 404 for a request that is not the user's draft", async () => {
    const a = await seedDirectoryActors(prisma);
    const change = await pendingOrg(a, "Alpha");

    const result = await onChange(a, discardAction as Action, "discard", a.focal.cookie, change.id);

    expect(statusOf(result)).toBe(404);
  });
});

describe("batch actions", () => {
  it("batch reject asks for a reason in the user's language", async () => {
    const a = await seedDirectoryActors(prisma);
    const change = await pendingOrg(a, "Alpha");

    const result = await act(
      a,
      batchRejectAction as Action,
      "approvals/batch-reject",
      french(a.manager.cookie),
      { "ids[]": [change.id] },
    );

    expect(statusOf(result)).toBe(400);
    expect(payloadOf<BatchPayload>(result).error).toBe("Un motif est requis.");
  });

  it.each([
    ["batch-approve", batchApproveAction as Action, "manager"],
    ["batch-reject", batchRejectAction as Action, "manager"],
    ["submit-drafts", submitDraftsAction as Action, "focal"],
  ] as const)("%s answers an empty selection with a message", async (path, action, who) => {
    const a = await seedDirectoryActors(prisma);

    const result = await act(a, action, `approvals/${path}`, french(a[who].cookie), {
      notes: "Motif",
    });

    expect(statusOf(result)).toBe(400);
    expect(payloadOf<BatchPayload>(result)).toMatchObject({
      result: null,
      error: "Sélectionnez au moins une modification.",
    });
  });

  it("batch approve reports what was done and what was skipped", async () => {
    const a = await seedDirectoryActors(prisma);
    const done = await approvedOrg(a, "Alpha");
    const open = await pendingOrg(a, "Beta");

    const result = await act(
      a,
      batchApproveAction as Action,
      "approvals/batch-approve",
      a.manager.cookie,
      { "ids[]": [done.id, open.id] },
    );

    const { result: outcome, error } = payloadOf<BatchPayload>(result);
    expect(error).toBeNull();
    expect(outcome?.succeeded).toEqual([{ id: open.id }]);
    expect(outcome?.skipped).toMatchObject([{ id: done.id }]);
    expect(outcome?.failed).toEqual([]);
  });

  it("submitting a stale draft reports the conflict in the user's language", async () => {
    const a = await seedDirectoryActors(prisma);
    await act(
      a,
      organizationEditorAction as Action,
      "organogram/new",
      a.manager.cookie,
      orgForm(a, "Version One"),
    );
    const org = await prisma.organization.findFirstOrThrow({ where: { name: "Version One" } });
    const rename = (cookie: string, name: string) =>
      act(
        a,
        organizationEditorAction as Action,
        `organogram/${org.id}/edit`,
        cookie,
        orgForm(a, name, { id: org.id, baseVersion: String(org.version) }),
        { orgId: org.id },
      );
    await rename(a.focal.cookie, "Focal Rename");
    await rename(a.manager.cookie, "Manager Rename");
    const draft = await prisma.changeRequest.findFirstOrThrow({ where: { status: "DRAFT" } });

    const result = await act(
      a,
      submitDraftsAction as Action,
      "approvals/submit-drafts",
      french(a.focal.cookie),
      { "ids[]": [draft.id] },
    );

    expect(payloadOf<BatchPayload>(result).result?.failed).toEqual([
      {
        id: draft.id,
        code: "VERSION_CONFLICT",
        message:
          "Cette fiche a été modifiée par quelqu'un d'autre après son ouverture. Rechargez la page et réessayez.",
      },
    ]);
  });
});
