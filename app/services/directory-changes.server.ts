import type { ChangeRequest, Prisma } from "~/generated/prisma/client.js";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import { logger } from "~/utils/monitoring/logger.server";
import {
  notifyManagersOfSubmission,
  notifyManagersOfSubmissions,
  notifySubmitterOfDecision,
} from "~/services/directory-notifications.server";
import {
  payloadSchemaFor,
  type ChangeOperationKey,
  type DirectoryEntityKey,
} from "~/utils/schemas/directory";
import { normaliseSearchTerm } from "~/utils/db/search.server";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

// Build a Prisma where-fragment that matches the search term against a
// change-request's submittedBy / reviewedBy user fields plus an exact
// `entityId` match. Used by all three list helpers (pending / mine /
// history) so the DataTable search box behaves consistently.
function buildChangeSearchFilter(raw: unknown): Prisma.ChangeRequestWhereInput {
  const term = normaliseSearchTerm(raw);
  if (!term) return {};
  const mode = "insensitive" as const;
  return {
    OR: [
      { entityId: term },
      { submittedBy: { firstName: { contains: term, mode } } },
      { submittedBy: { lastName: { contains: term, mode } } },
      { submittedBy: { email: { contains: term, mode } } },
      { reviewedBy: { firstName: { contains: term, mode } } },
      { reviewedBy: { lastName: { contains: term, mode } } },
      { reviewedBy: { email: { contains: term, mode } } },
    ],
  };
}

import {
  _applyCreateOrg,
  _applyMoveOrg,
  _applySoftDeleteOrg,
  _applyUpdateOrg,
} from "~/services/organizations.server";
import {
  _applyCreatePerson,
  _applySoftDeletePerson,
  _applyUpdatePerson,
} from "~/services/people.server";
import {
  _applyCreatePosition,
  _applySoftDeletePosition,
  _applyUpdatePosition,
} from "~/services/positions.server";
import {
  _applyCreateAssignment,
  _applySoftDeleteAssignment,
  _applyUpdateAssignment,
} from "~/services/position-assignments.server";

// Directory change-request engine.
//
// Every directory mutation (by focal persons OR managers) flows through
// this module. Real entity services expose `_apply*` writers for CREATE /
// UPDATE / DELETE / MOVE — never called directly from routes — and this
// engine dispatches to them inside a single DB transaction on approval.

export class ChangeRequestError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "CHANGE_REQUEST_ERROR") {
    super(message);
    this.name = "ChangeRequestError";
    this.status = status;
    this.code = code;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────

export type SubmitInput = {
  entityType: DirectoryEntityKey;
  operation: ChangeOperationKey;
  entityId?: string;
  payload: unknown;
};

export type AppliedEntity = { id: string };

export type BatchItemOk = { id: string; change: ChangeRequest };
export type BatchItemFail = { id: string; code: string; message: string };
export type BatchItemSkip = { id: string; reason: "NOT_PENDING" | "NOT_DRAFT" | "NOT_FOUND" };

export type BatchResult = {
  succeeded: BatchItemOk[];
  failed: BatchItemFail[];
  skipped: BatchItemSkip[];
};

const changeListInclude = {
  submittedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  reviewedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} as const;

// Row shape returned by listPendingChanges / listMyChanges / listChangeHistory.
// Exported so UI layers pick up new fields automatically if changeListInclude
// grows.
export type ChangeListRow = ChangeRequest & {
  submittedBy: { id: string; firstName: string; lastName: string; email: string };
  reviewedBy: { id: string; firstName: string; lastName: string; email: string } | null;
};

// ─── Guards ─────────────────────────────────────────────────────────────

export async function assertNoPendingConflict(
  tenantId: string,
  entityType: DirectoryEntityKey,
  entityId: string | null | undefined,
) {
  if (!entityId) return; // CREATE — never collides (no entity yet).
  const existing = await prisma.changeRequest.findFirst({
    where: { tenantId, entityType, entityId, status: "PENDING" },
    select: { id: true, submittedById: true },
  });
  if (existing) {
    throw new ChangeRequestError(
      "A pending change already exists for this record. Withdraw it or wait for review.",
      409,
      "PENDING_REQUEST_EXISTS",
    );
  }
}

// Serialize concurrent submits for the same entity with a transaction-scoped
// Postgres advisory lock, closing the check-then-insert TOCTOU in
// `assertNoPendingConflict` without a DB migration (survives `prisma db push`,
// which the template uses). Only meaningful for UPDATE/DELETE/MOVE — a CREATE
// has no entityId, and two creates are independent proposals, not a conflict.
// The second submitter blocks on the lock until the first transaction commits,
// then its re-check inside the lock sees the PENDING row and rejects.
async function lockEntityAndAssertNoPending(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: DirectoryEntityKey,
  entityId: string | null | undefined,
) {
  if (!entityId) return;
  const key = `dirchange:${tenantId}:${entityType}:${entityId}`;
  // `$executeRaw` (not `$queryRaw`): pg_advisory_xact_lock returns void, which
  // $queryRaw can't deserialize. executeRaw just runs the statement.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const existing = await tx.changeRequest.findFirst({
    where: { tenantId, entityType, entityId, status: "PENDING" },
    select: { id: true },
  });
  if (existing) {
    throw new ChangeRequestError(
      "A pending change already exists for this record. Withdraw it or wait for review.",
      409,
      "PENDING_REQUEST_EXISTS",
    );
  }
}

function extractBaseVersion(payload: unknown): number | undefined {
  if (payload && typeof payload === "object" && "baseVersion" in payload) {
    const v = (payload as { baseVersion?: unknown }).baseVersion;
    if (typeof v === "number" && Number.isInteger(v)) return v;
  }
  return undefined;
}

// Optimistic-concurrency check: reject an edit built against a version of the
// entity that has since moved on. Runs inside the same transaction (after the
// advisory lock) so it sees the committed live state. A no-op when the caller
// didn't send a baseVersion (CREATE, or a legacy form).
async function assertVersionMatches(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: DirectoryEntityKey,
  entityId: string,
  baseVersion: number | undefined,
) {
  if (baseVersion === undefined) return;
  const where = { id: entityId, tenantId, deletedAt: null };
  const select = { version: true } as const;
  let live: { version: number } | null = null;
  switch (entityType) {
    case "ORGANIZATION":
      live = await tx.organization.findFirst({ where, select });
      break;
    case "PERSON":
      live = await tx.person.findFirst({ where, select });
      break;
    case "POSITION":
      live = await tx.position.findFirst({ where, select });
      break;
    case "POSITION_ASSIGNMENT":
      live = await tx.positionAssignment.findFirst({ where, select });
      break;
  }
  // `live === null` (not found / soft-deleted) is left to the applier's own
  // NOT_FOUND handling; only a genuine version mismatch is a conflict here.
  if (live && live.version !== baseVersion) {
    throw new ChangeRequestError(
      "This record was changed by someone else since you opened it. Reload and try again.",
      409,
      "VERSION_CONFLICT",
    );
  }
}

function validatePayload(
  entityType: DirectoryEntityKey,
  operation: ChangeOperationKey,
  payload: unknown,
): unknown {
  const schema = payloadSchemaFor(entityType, operation);
  const result = schema.safeParse(payload);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path?.join(".") ?? "";
    throw new ChangeRequestError(
      `Invalid payload${path ? ` (${path})` : ""}: ${firstIssue?.message ?? "validation failed"}`,
      400,
      "INVALID_PAYLOAD",
    );
  }
  return result.data;
}

// ─── Submit ─────────────────────────────────────────────────────────────

export async function submitChange(input: SubmitInput, ctx: TenantServiceContext) {
  const validated = validatePayload(input.entityType, input.operation, input.payload);

  if (
    (input.operation === "UPDATE" || input.operation === "DELETE" || input.operation === "MOVE") &&
    !input.entityId
  ) {
    throw new ChangeRequestError(`${input.operation} requires entityId`, 400, "MISSING_ENTITY_ID");
  }
  if (input.operation === "CREATE" && input.entityId) {
    throw new ChangeRequestError("CREATE must not include entityId", 400, "UNEXPECTED_ENTITY_ID");
  }

  logger.info(
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: input.entityType,
      operation: input.operation,
      entityId: input.entityId,
    },
    "submitting change request",
  );

  // Lock + conflict-check + insert in one transaction so two concurrent
  // submits for the same entity can't both create a PENDING row.
  const change = await prisma.$transaction(async (tx) => {
    await lockEntityAndAssertNoPending(tx, ctx.tenantId, input.entityType, input.entityId);
    if (input.entityId && (input.operation === "UPDATE" || input.operation === "MOVE")) {
      await assertVersionMatches(
        tx,
        ctx.tenantId,
        input.entityType,
        input.entityId,
        extractBaseVersion(validated),
      );
    }
    return tx.changeRequest.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        operation: input.operation,
        payload: validated as Prisma.InputJsonValue,
        submittedById: ctx.userId,
        status: "PENDING",
        approvalMode: "REVIEWED",
      },
      include: changeListInclude,
    });
  });

  emitDomainEvent(ctx.tenantId, "change.submitted", {
    id: change.id,
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    submittedById: change.submittedById,
  });

  await notifyManagersOfSubmission(change, change.submittedBy);

  return change;
}

// ─── Drafts ─────────────────────────────────────────────────────────────
//
// A focal person's save lands as a DRAFT: visible only to its author, never
// in the approval queue, no events, no notifications. `submitDrafts` moves a
// selection of drafts to PENDING; from there the normal review flow applies.

/**
 * Create a draft, or — when `draftId` is given — replace the payload of the
 * caller's own existing draft. A draft never blocks other users; the only
 * open-change rule applied here is that an author cannot hold two drafts for
 * the same record (`DRAFT_EXISTS`). The stale-edit and pending-conflict
 * checks run later, in `submitDrafts`.
 */
export async function saveDraft(
  input: SubmitInput,
  ctx: TenantServiceContext,
  options: { draftId?: string } = {},
) {
  const validated = validatePayload(input.entityType, input.operation, input.payload);

  if (
    (input.operation === "UPDATE" || input.operation === "DELETE" || input.operation === "MOVE") &&
    !input.entityId
  ) {
    throw new ChangeRequestError(`${input.operation} requires entityId`, 400, "MISSING_ENTITY_ID");
  }
  if (input.operation === "CREATE" && input.entityId) {
    throw new ChangeRequestError("CREATE must not include entityId", 400, "UNEXPECTED_ENTITY_ID");
  }
  const entityId = input.entityId ?? null;

  return prisma.$transaction(async (tx) => {
    if (options.draftId) {
      const existing = await tx.changeRequest.findFirst({
        where: {
          id: options.draftId,
          tenantId: ctx.tenantId,
          submittedById: ctx.userId,
          status: "DRAFT",
        },
        select: { id: true, entityType: true, operation: true, entityId: true },
      });
      if (!existing) throw new ChangeRequestError("Draft not found", 404, "NOT_FOUND");
      if (
        existing.entityType !== input.entityType ||
        existing.operation !== input.operation ||
        existing.entityId !== entityId
      ) {
        throw new ChangeRequestError(
          "This draft belongs to a different record",
          400,
          "DRAFT_MISMATCH",
        );
      }
      return tx.changeRequest.update({
        where: { id: existing.id },
        data: { payload: validated as Prisma.InputJsonValue },
        include: changeListInclude,
      });
    }

    if (entityId) {
      // Serialize the author's concurrent saves for this record (double
      // click) so the check below cannot be raced into two drafts.
      const key = `dirdraft:${ctx.tenantId}:${ctx.userId}:${input.entityType}:${entityId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const own = await tx.changeRequest.findFirst({
        where: {
          tenantId: ctx.tenantId,
          submittedById: ctx.userId,
          entityType: input.entityType,
          entityId,
          status: "DRAFT",
        },
        select: { id: true },
      });
      if (own) {
        throw new ChangeRequestError(
          "You already have a draft for this record. Edit or discard that draft first.",
          409,
          "DRAFT_EXISTS",
        );
      }
    }

    return tx.changeRequest.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId,
        operation: input.operation,
        payload: validated as Prisma.InputJsonValue,
        submittedById: ctx.userId,
        status: "DRAFT",
        approvalMode: "REVIEWED",
      },
      include: changeListInclude,
    });
  });
}

/** The caller's own draft, or null. Other users' drafts are never returned. */
export async function getOwnDraft(id: string, ctx: TenantServiceContext) {
  return prisma.changeRequest.findFirst({
    where: { id, tenantId: ctx.tenantId, submittedById: ctx.userId, status: "DRAFT" },
  });
}

/** The caller's own draft against a published record, or null. */
export async function findOwnDraftForEntity(
  entityType: DirectoryEntityKey,
  entityId: string,
  ctx: TenantServiceContext,
) {
  return prisma.changeRequest.findFirst({
    where: {
      tenantId: ctx.tenantId,
      submittedById: ctx.userId,
      entityType,
      entityId,
      status: "DRAFT",
    },
  });
}

/** Delete the caller's own draft. Anything else is reported as not found. */
export async function discardDraft(id: string, ctx: TenantServiceContext) {
  const deleted = await prisma.changeRequest.deleteMany({
    where: { id, tenantId: ctx.tenantId, submittedById: ctx.userId, status: "DRAFT" },
  });
  if (deleted.count === 0) throw new ChangeRequestError("Draft not found", 404, "NOT_FOUND");
}

async function submitDraft(id: string, ctx: TenantServiceContext): Promise<ChangeListRow> {
  // Scoped to the author: someone else's draft is indistinguishable from a
  // missing one.
  const draft = await prisma.changeRequest.findFirst({
    where: { id, tenantId: ctx.tenantId, submittedById: ctx.userId },
  });
  if (!draft) throw new ChangeRequestError("Draft not found", 404, "NOT_FOUND");
  if (draft.status !== "DRAFT") {
    throw new ChangeRequestError(
      `Cannot submit: current status is ${draft.status}`,
      409,
      "NOT_DRAFT",
    );
  }
  const entityType = draft.entityType as DirectoryEntityKey;

  const change = await prisma.$transaction(async (tx) => {
    await lockEntityAndAssertNoPending(tx, ctx.tenantId, entityType, draft.entityId);
    if (draft.entityId && (draft.operation === "UPDATE" || draft.operation === "MOVE")) {
      await assertVersionMatches(
        tx,
        ctx.tenantId,
        entityType,
        draft.entityId,
        extractBaseVersion(draft.payload),
      );
    }
    const claim = await tx.changeRequest.updateMany({
      where: { id, tenantId: ctx.tenantId, submittedById: ctx.userId, status: "DRAFT" },
      data: { status: "PENDING", submittedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ChangeRequestError("Cannot submit: no longer a draft", 409, "NOT_DRAFT");
    }
    return tx.changeRequest.findFirstOrThrow({ where: { id }, include: changeListInclude });
  });

  emitDomainEvent(ctx.tenantId, "change.submitted", {
    id: change.id,
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    submittedById: change.submittedById,
  });

  return change;
}

/**
 * Submit the caller's drafts for review. Atomic per draft, same cap and
 * skipped / failed reporting as batch approve: ids that are not the caller's
 * drafts are `skipped`; a stale edit (`VERSION_CONFLICT`) or a record that
 * already has a pending change (`PENDING_REQUEST_EXISTS`) is `failed` and
 * stays a draft. Approvers get ONE notification for the whole call.
 */
export async function submitDrafts(ids: string[], ctx: TenantServiceContext): Promise<BatchResult> {
  assertBatchSize(ids);
  const submitted: ChangeListRow[] = [];
  const result = await runBatch(
    ids,
    async (id) => {
      const change = await submitDraft(id, ctx);
      submitted.push(change);
      return change;
    },
    ctx,
  );
  if (submitted.length > 0) {
    await notifyManagersOfSubmissions(submitted, submitted[0].submittedBy);
  }
  return result;
}

// ─── Apply (shared by approve + submitAndApply) ─────────────────────────

type ApplyOperationInput = {
  tenantId: string;
  entityType: DirectoryEntityKey;
  entityId: string | null;
  operation: ChangeOperationKey;
  payload: unknown;
};

// Every applier takes the same (tenantId, entityId?, payload, ctx, tx)
// shape and produces an entity row. The outer dispatcher validates the
// payload once and passes the tx so the guards + writes run atomically.
type Applier = (
  change: ApplyOperationInput,
  ctx: TenantServiceContext,
  tx: Prisma.TransactionClient,
) => Promise<{ id: string }>;

const APPLIERS: Record<DirectoryEntityKey, Partial<Record<ChangeOperationKey, Applier>>> = {
  ORGANIZATION: {
    CREATE: (c, ctx, tx) => _applyCreateOrg(c.tenantId, c.payload as never, ctx, tx),
    UPDATE: (c, ctx, tx) => _applyUpdateOrg(c.entityId!, c.tenantId, c.payload as never, ctx, tx),
    MOVE: (c, ctx, tx) => _applyMoveOrg(c.entityId!, c.tenantId, c.payload as never, ctx, tx),
    DELETE: (c, ctx, tx) => _applySoftDeleteOrg(c.entityId!, c.tenantId, ctx, tx),
  },
  PERSON: {
    CREATE: (c, ctx, tx) => _applyCreatePerson(c.tenantId, c.payload as never, ctx, tx),
    UPDATE: (c, ctx, tx) =>
      _applyUpdatePerson(c.entityId!, c.tenantId, c.payload as never, ctx, tx),
    DELETE: (c, ctx, tx) => _applySoftDeletePerson(c.entityId!, c.tenantId, ctx, tx),
  },
  POSITION: {
    CREATE: (c, ctx, tx) => _applyCreatePosition(c.tenantId, c.payload as never, ctx, tx),
    UPDATE: (c, ctx, tx) =>
      _applyUpdatePosition(c.entityId!, c.tenantId, c.payload as never, ctx, tx),
    DELETE: (c, ctx, tx) => _applySoftDeletePosition(c.entityId!, c.tenantId, ctx, tx),
  },
  POSITION_ASSIGNMENT: {
    CREATE: (c, ctx, tx) => _applyCreateAssignment(c.tenantId, c.payload as never, ctx, tx),
    UPDATE: (c, ctx, tx) =>
      _applyUpdateAssignment(c.entityId!, c.tenantId, c.payload as never, ctx, tx),
    DELETE: (c, ctx, tx) => _applySoftDeleteAssignment(c.entityId!, c.tenantId, ctx, tx),
  },
};

async function applyOperation(
  tx: Prisma.TransactionClient,
  change: ApplyOperationInput,
  ctx: TenantServiceContext,
): Promise<{ id: string }> {
  // Re-validate here as well as at submit: the payload was stored as JSON
  // and may have drifted from the current schema between submit and approve
  // (new required field added, etc.). This is also a safety net for the
  // `submitAndApply` path which skips the usual submit-time revalidation.
  const validated = validatePayload(change.entityType, change.operation, change.payload);

  const applier = APPLIERS[change.entityType]?.[change.operation];
  if (!applier) {
    throw new ChangeRequestError(
      `Unsupported operation ${change.operation} for ${change.entityType}`,
      400,
      "UNSUPPORTED_OPERATION",
    );
  }
  return applier({ ...change, payload: validated }, ctx, tx);
}

function domainEventFor(
  entityType: DirectoryEntityKey,
  operation: ChangeOperationKey,
  payload?: unknown,
): string {
  const entity = entityType === "POSITION_ASSIGNMENT" ? "position" : entityType.toLowerCase();
  if (entityType === "POSITION_ASSIGNMENT") {
    if (operation === "CREATE") return "position.assigned";
    if (operation === "DELETE") return "position.ended";
    if (operation === "UPDATE") {
      // An UPDATE only "ends" the assignment when it now carries an endDate.
      // A reopen/reassign (or a notes-only edit) is an active assignment, so
      // don't mislabel it as `position.ended`.
      const hasEndDate =
        !!payload &&
        typeof payload === "object" &&
        "endDate" in payload &&
        Boolean((payload as { endDate?: unknown }).endDate);
      return hasEndDate ? "position.ended" : "position.assigned";
    }
  }
  switch (operation) {
    case "CREATE":
      return `${entity}.created`;
    case "UPDATE":
      return `${entity}.updated`;
    case "DELETE":
      return `${entity}.deleted`;
    case "MOVE":
      return `${entity}.moved`;
  }
}

// ─── Approve ────────────────────────────────────────────────────────────

export async function approveChange(
  id: string,
  { notes }: { notes?: string },
  ctx: TenantServiceContext,
) {
  const change = await prisma.changeRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  // A draft is private to its author — to a reviewer it does not exist.
  if (!change || change.status === "DRAFT") {
    throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
  }
  if (change.status !== "PENDING") {
    throw new ChangeRequestError(
      `Cannot approve: current status is ${change.status}`,
      409,
      "NOT_PENDING",
    );
  }

  logger.info(
    { tenantId: ctx.tenantId, userId: ctx.userId, changeId: id },
    "approving change request",
  );

  const result = await prisma.$transaction(async (tx) => {
    // Claim the row FIRST with a conditional, status-guarded update. The
    // pre-check above is outside the transaction and offers no protection
    // against a concurrent approval (double-click, client retry, two
    // reviewers). Two concurrent approves would otherwise both reach
    // `applyOperation` and, for a CREATE, insert two entity rows from one
    // request. `updateMany` takes a row lock and re-evaluates its WHERE after
    // the winner commits, so the loser matches zero rows and rolls back
    // before applying anything.
    const claim = await tx.changeRequest.updateMany({
      where: { id, tenantId: ctx.tenantId, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
        appliedAt: new Date(),
        reviewerNotes: notes ?? null,
      },
    });
    if (claim.count === 0) {
      throw new ChangeRequestError(
        "Cannot approve: the change is no longer pending",
        409,
        "NOT_PENDING",
      );
    }

    const entity = await applyOperation(
      tx,
      {
        tenantId: change.tenantId,
        entityType: change.entityType as DirectoryEntityKey,
        entityId: change.entityId,
        operation: change.operation as ChangeOperationKey,
        payload: change.payload,
      },
      ctx,
    );
    const updated = await tx.changeRequest.update({
      where: { id },
      data: { entityId: entity.id },
      include: changeListInclude,
    });
    return { change: updated, entity };
  });

  emitDomainEvent(ctx.tenantId, "change.approved", {
    id: result.change.id,
    entityType: result.change.entityType,
    entityId: result.change.entityId,
    operation: result.change.operation,
    reviewedById: result.change.reviewedById,
  });
  emitDomainEvent(
    ctx.tenantId,
    domainEventFor(
      result.change.entityType as DirectoryEntityKey,
      result.change.operation as ChangeOperationKey,
      result.change.payload,
    ),
    { id: result.change.entityId, changeId: result.change.id },
  );

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "APPROVE_CHANGE",
    entityType: "ChangeRequest",
    entityId: result.change.id,
    description: `Approved ${result.change.operation} ${result.change.entityType}`,
    metadata: {
      approvalMode: "REVIEWED",
      targetEntityId: result.change.entityId,
    },
  });

  if (result.change.reviewedBy) {
    await notifySubmitterOfDecision(
      result.change,
      "APPROVED",
      result.change.reviewedBy,
      notes ?? null,
    );
  }

  return result;
}

// ─── Reject ─────────────────────────────────────────────────────────────

export async function rejectChange(
  id: string,
  { notes }: { notes: string },
  ctx: TenantServiceContext,
) {
  const change = await prisma.changeRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!change || change.status === "DRAFT") {
    throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
  }
  if (change.status !== "PENDING") {
    throw new ChangeRequestError(
      `Cannot reject: current status is ${change.status}`,
      409,
      "NOT_PENDING",
    );
  }

  logger.info(
    { tenantId: ctx.tenantId, userId: ctx.userId, changeId: id },
    "rejecting change request",
  );

  // Status-guarded transition so a concurrent reject/approve can't double-fire
  // the event + submitter notification below.
  const claim = await prisma.changeRequest.updateMany({
    where: { id, tenantId: ctx.tenantId, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
      reviewerNotes: notes,
    },
  });
  if (claim.count === 0) {
    throw new ChangeRequestError(
      "Cannot reject: the change is no longer pending",
      409,
      "NOT_PENDING",
    );
  }
  const updated = await prisma.changeRequest.findFirstOrThrow({
    where: { id },
    include: changeListInclude,
  });

  emitDomainEvent(ctx.tenantId, "change.rejected", {
    id: updated.id,
    entityType: updated.entityType,
    entityId: updated.entityId,
    operation: updated.operation,
    reviewedById: updated.reviewedById,
  });

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "REJECT_CHANGE",
    entityType: "ChangeRequest",
    entityId: updated.id,
    description: `Rejected ${updated.operation} ${updated.entityType}`,
    metadata: { reason: notes },
  });

  if (updated.reviewedBy) {
    await notifySubmitterOfDecision(updated, "REJECTED", updated.reviewedBy, notes);
  }

  return updated;
}

// ─── Withdraw ───────────────────────────────────────────────────────────

export async function withdrawChange(id: string, ctx: TenantServiceContext) {
  const change = await prisma.changeRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!change || (change.status === "DRAFT" && change.submittedById !== ctx.userId)) {
    throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
  }
  if (change.status !== "PENDING") {
    throw new ChangeRequestError(
      `Cannot withdraw: current status is ${change.status}`,
      409,
      "NOT_PENDING",
    );
  }
  if (change.submittedById !== ctx.userId) {
    throw new ChangeRequestError("Only the submitter can withdraw a change", 403, "NOT_SUBMITTER");
  }

  const claim = await prisma.changeRequest.updateMany({
    where: { id, tenantId: ctx.tenantId, status: "PENDING", submittedById: ctx.userId },
    data: { status: "WITHDRAWN", reviewedAt: new Date() },
  });
  if (claim.count === 0) {
    throw new ChangeRequestError(
      "Cannot withdraw: the change is no longer pending",
      409,
      "NOT_PENDING",
    );
  }
  const updated = await prisma.changeRequest.findFirstOrThrow({
    where: { id },
    include: changeListInclude,
  });

  emitDomainEvent(ctx.tenantId, "change.withdrawn", {
    id: updated.id,
    entityType: updated.entityType,
    entityId: updated.entityId,
  });

  return updated;
}

// ─── Submit + apply (manager direct-edit) ───────────────────────────────

export async function submitAndApply(input: SubmitInput, ctx: TenantServiceContext) {
  const validated = validatePayload(input.entityType, input.operation, input.payload);

  if (
    (input.operation === "UPDATE" || input.operation === "DELETE" || input.operation === "MOVE") &&
    !input.entityId
  ) {
    throw new ChangeRequestError(`${input.operation} requires entityId`, 400, "MISSING_ENTITY_ID");
  }

  logger.info(
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: input.entityType,
      operation: input.operation,
      entityId: input.entityId,
    },
    "submit+apply change request (self-approved)",
  );

  const result = await prisma.$transaction(async (tx) => {
    // Same lock as submitChange — a manager's direct edit must not race with a
    // focal submission (or another manager) for the same entity.
    await lockEntityAndAssertNoPending(tx, ctx.tenantId, input.entityType, input.entityId);
    if (input.entityId && (input.operation === "UPDATE" || input.operation === "MOVE")) {
      await assertVersionMatches(
        tx,
        ctx.tenantId,
        input.entityType,
        input.entityId,
        extractBaseVersion(validated),
      );
    }
    const entity = await applyOperation(
      tx,
      {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        operation: input.operation,
        payload: validated,
      },
      ctx,
    );
    const change = await tx.changeRequest.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: entity.id,
        operation: input.operation,
        payload: validated as Prisma.InputJsonValue,
        status: "APPROVED",
        approvalMode: "SELF_APPROVED",
        submittedById: ctx.userId,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
        appliedAt: new Date(),
      },
      include: changeListInclude,
    });
    return { change, entity };
  });

  emitDomainEvent(ctx.tenantId, domainEventFor(input.entityType, input.operation, validated), {
    id: result.change.entityId,
    changeId: result.change.id,
    selfApproved: true,
  });

  await writeAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: "SELF_APPROVE_CHANGE",
    entityType: "ChangeRequest",
    entityId: result.change.id,
    description: `Self-approved ${input.operation} ${input.entityType}`,
    metadata: { approvalMode: "SELF_APPROVED", targetEntityId: result.change.entityId },
  });

  return result;
}

// ─── Batch approve / reject ─────────────────────────────────────────────

// Each batch item runs in its own transaction (one apply + one changeRequest
// update + one audit write + event emission). A huge batch ties up a single
// HTTP request for minutes and holds a DB connection. Cap at 100 as a DoS
// guard — if an API consumer needs more, they can page through the queue.
export const MAX_BATCH_SIZE = 100;

function assertBatchSize(ids: string[]) {
  if (ids.length === 0) {
    throw new ChangeRequestError("Select at least one change", 400, "EMPTY_BATCH");
  }
  if (ids.length > MAX_BATCH_SIZE) {
    throw new ChangeRequestError(
      `Batch too large. Max ${MAX_BATCH_SIZE} changes per request.`,
      400,
      "BATCH_TOO_LARGE",
    );
  }
}

export async function approveChanges(
  ids: string[],
  { notes }: { notes?: string },
  ctx: TenantServiceContext,
): Promise<BatchResult> {
  assertBatchSize(ids);
  return runBatch(ids, (id) => approveChange(id, { notes }, ctx).then((r) => r.change), ctx);
}

export async function rejectChanges(
  ids: string[],
  { notes }: { notes: string },
  ctx: TenantServiceContext,
): Promise<BatchResult> {
  assertBatchSize(ids);
  return runBatch(ids, (id) => rejectChange(id, { notes }, ctx), ctx);
}

// Compose a short "N approved · M skipped · K failed" summary from a
// BatchResult for inline feedback after a batch action. Callers pass the
// verb that matches the action (approved | rejected | withdrawn).
export function formatBatchSummary(
  result: BatchResult,
  verb: "approved" | "rejected" | "withdrawn" | "submitted",
): string {
  const parts: string[] = [];
  if (result.succeeded.length > 0) parts.push(`${result.succeeded.length} ${verb}`);
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
  return parts.join(" · ") || "No changes processed";
}

// Shared batch loop: one authoritative call per id. NOT_FOUND / NOT_PENDING
// surface as ChangeRequestError codes from the inner call — we bucket them
// as `skipped` rather than `failed` so the UI summary is "5 approved, 0
// failed, 2 skipped" instead of alarming the user with red counts for a
// benign race (submitter withdrew between click and apply).
async function runBatch(
  ids: string[],
  run: (id: string) => Promise<ChangeRequest>,
  ctx: TenantServiceContext,
): Promise<BatchResult> {
  const result: BatchResult = { succeeded: [], failed: [], skipped: [] };
  for (const id of ids) {
    try {
      const change = await run(id);
      result.succeeded.push({ id, change });
    } catch (error) {
      if (error instanceof ChangeRequestError) {
        if (error.code === "NOT_FOUND") {
          result.skipped.push({ id, reason: "NOT_FOUND" });
          continue;
        }
        if (error.code === "NOT_PENDING" || error.code === "NOT_DRAFT") {
          result.skipped.push({ id, reason: error.code });
          continue;
        }
      }
      const msg = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof ChangeRequestError
          ? error.code
          : error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : "UNKNOWN";
      result.failed.push({ id, code, message: msg });
      logger.warn(
        { tenantId: ctx.tenantId, userId: ctx.userId, changeId: id, code, message: msg },
        "batch item failed",
      );
    }
  }
  return result;
}

// ─── Reads ──────────────────────────────────────────────────────────────

export async function listPendingChanges(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const filter: Prisma.ChangeRequestWhereInput = {
    tenantId,
    status: "PENDING",
    ...(where.entityType ? { entityType: where.entityType as DirectoryEntityKey } : {}),
    ...(where.submittedById ? { submittedById: where.submittedById as string } : {}),
    ...buildChangeSearchFilter(where.search),
  };

  const [data, total] = await Promise.all([
    prisma.changeRequest.findMany({
      where: filter,
      orderBy: orderBy ?? [{ submittedAt: "desc" }],
      skip,
      take: pageSize,
      include: changeListInclude,
    }),
    prisma.changeRequest.count({ where: filter }),
  ]);
  return { data, total };
}

export async function listMyChanges(
  tenantId: string,
  userId: string,
  options: PaginatedQueryOptions,
) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const filter: Prisma.ChangeRequestWhereInput = {
    tenantId,
    submittedById: userId,
    ...(where.status ? { status: where.status as ChangeRequest["status"] } : {}),
    ...buildChangeSearchFilter(where.search),
  };

  const [data, total] = await Promise.all([
    prisma.changeRequest.findMany({
      where: filter,
      orderBy: orderBy ?? [{ submittedAt: "desc" }],
      skip,
      take: pageSize,
      include: changeListInclude,
    }),
    prisma.changeRequest.count({ where: filter }),
  ]);
  return { data, total };
}

export async function listChangeHistory(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const filter: Prisma.ChangeRequestWhereInput = {
    tenantId,
    status: { in: ["APPROVED", "REJECTED", "WITHDRAWN"] },
    ...(where.entityType ? { entityType: where.entityType as DirectoryEntityKey } : {}),
    ...(where.entityId ? { entityId: where.entityId as string } : {}),
    ...buildChangeSearchFilter(where.search),
  };

  const [data, total] = await Promise.all([
    prisma.changeRequest.findMany({
      where: filter,
      orderBy: orderBy ?? [{ reviewedAt: "desc" }],
      skip,
      take: pageSize,
      include: changeListInclude,
    }),
    prisma.changeRequest.count({ where: filter }),
  ]);
  return { data, total };
}

// `viewerId` is required so no caller can forget the draft rule: a DRAFT is
// visible only to its author and reads as not-found for everyone else.
export async function getChange(id: string, tenantId: string, viewerId: string) {
  const change = await prisma.changeRequest.findFirst({
    where: { id, tenantId },
    include: changeListInclude,
  });
  if (!change || (change.status === "DRAFT" && change.submittedById !== viewerId)) {
    throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
  }
  return change;
}

// ─── Diff ───────────────────────────────────────────────────────────────

export type FieldDiff = {
  field: string;
  before: unknown;
  after: unknown;
};

// Payload keys that are transport metadata, not entity fields. `baseVersion`
// is the optimistic-concurrency token; the live entity has no such column, so
// without this it would show up as a changed field on every edit.
const NON_DIFF_FIELDS = new Set(["baseVersion"]);

export async function computeDiff(change: ChangeRequest): Promise<FieldDiff[]> {
  if (change.operation === "CREATE") {
    // No "before" — every field in the payload is a new value.
    const payload = change.payload as Record<string, unknown> | null;
    if (!payload) return [];
    return Object.entries(payload)
      .filter(([field]) => !NON_DIFF_FIELDS.has(field))
      .map(([field, after]) => ({
        field,
        before: null,
        after,
      }));
  }

  if (change.operation === "DELETE") {
    // "after" is null for every current field — show the payload's `reason`
    // as the only diff entry so managers see why it was requested.
    const payload = change.payload as { reason?: string } | null;
    return [
      {
        field: "reason",
        before: null,
        after: payload?.reason ?? null,
      },
    ];
  }

  // UPDATE / MOVE — fetch the current live entity and diff per-field.
  if (!change.entityId) return [];
  const live = await fetchLiveEntity(
    change.entityType as DirectoryEntityKey,
    change.entityId,
    change.tenantId,
  );
  if (!live) return [];

  const payload = (change.payload as Record<string, unknown>) ?? {};
  const diffs: FieldDiff[] = [];
  for (const field of Object.keys(payload)) {
    if (NON_DIFF_FIELDS.has(field)) continue;
    const before = (live as Record<string, unknown>)[field];
    const after = payload[field];
    if (!deepEqual(before, after)) {
      diffs.push({ field, before: before ?? null, after });
    }
  }

  // Hydrate cuid references to their human-readable names so the approval
  // UI shows "Department of Infrastructure" instead of a raw cuid. Keeps
  // the `field` name unchanged so consumers still dispatch per-field;
  // only the before/after values swap to display strings.
  await hydrateReferenceIds(change.entityType as DirectoryEntityKey, diffs, change.tenantId);

  return diffs;
}

// Fields whose values are cuid references to another entity we can resolve
// to a display name. Keyed by entityType so we only run the lookups we need.
const REFERENCE_FIELDS: Partial<Record<DirectoryEntityKey, string[]>> = {
  ORGANIZATION: ["parentId", "typeId"],
  PERSON: ["memberStateId"],
  POSITION: ["organizationId", "typeId", "reportsToId"],
  POSITION_ASSIGNMENT: ["personId", "positionId"],
};

async function hydrateReferenceIds(
  entityType: DirectoryEntityKey,
  diffs: FieldDiff[],
  tenantId: string,
): Promise<void> {
  const refFields = REFERENCE_FIELDS[entityType];
  if (!refFields || refFields.length === 0) return;

  // Collect every cuid that shows up in a reference field's before/after.
  const idsByResolver: Record<string, Set<string>> = {};
  function record(resolver: string, id: unknown) {
    if (typeof id !== "string" || !id) return;
    (idsByResolver[resolver] ??= new Set()).add(id);
  }

  for (const diff of diffs) {
    if (!refFields.includes(diff.field)) continue;
    const resolver = resolverFor(entityType, diff.field);
    if (!resolver) continue;
    record(resolver, diff.before);
    record(resolver, diff.after);
  }

  const names: Record<string, Record<string, string>> = {};
  await Promise.all(
    Object.entries(idsByResolver).map(async ([resolver, ids]) => {
      const resolved = await resolveNames(resolver, [...ids], tenantId);
      names[resolver] = resolved;
    }),
  );

  for (const diff of diffs) {
    if (!refFields.includes(diff.field)) continue;
    const resolver = resolverFor(entityType, diff.field);
    if (!resolver) continue;
    const lookup = names[resolver] ?? {};
    diff.before =
      typeof diff.before === "string" ? (lookup[diff.before] ?? diff.before) : diff.before;
    diff.after = typeof diff.after === "string" ? (lookup[diff.after] ?? diff.after) : diff.after;
  }
}

function resolverFor(entityType: DirectoryEntityKey, field: string): string | null {
  if (entityType === "ORGANIZATION" && field === "parentId") return "organization";
  if (entityType === "ORGANIZATION" && field === "typeId") return "organizationType";
  if (entityType === "PERSON" && field === "memberStateId") return "memberState";
  if (entityType === "POSITION" && field === "organizationId") return "organization";
  if (entityType === "POSITION" && field === "typeId") return "positionType";
  if (entityType === "POSITION" && field === "reportsToId") return "position";
  if (entityType === "POSITION_ASSIGNMENT" && field === "personId") return "person";
  if (entityType === "POSITION_ASSIGNMENT" && field === "positionId") return "position";
  return null;
}

async function resolveNames(
  resolver: string,
  ids: string[],
  tenantId: string,
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  switch (resolver) {
    case "organization": {
      const rows = await prisma.organization.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true, acronym: true },
      });
      return Object.fromEntries(
        rows.map((r) => [r.id, r.acronym ? `${r.name} (${r.acronym})` : r.name]),
      );
    }
    case "organizationType": {
      const rows = await prisma.organizationType.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, r.name]));
    }
    case "memberState": {
      const rows = await prisma.memberState.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, fullName: true, abbreviation: true },
      });
      return Object.fromEntries(
        rows.map((r) => [r.id, r.abbreviation ? `${r.fullName} (${r.abbreviation})` : r.fullName]),
      );
    }
    case "positionType": {
      const rows = await prisma.positionType.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, r.name]));
    }
    case "position": {
      const rows = await prisma.position.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, title: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, r.title]));
    }
    case "person": {
      const rows = await prisma.person.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, firstName: true, lastName: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));
    }
    default:
      return {};
  }
}

async function fetchLiveEntity(entityType: DirectoryEntityKey, entityId: string, tenantId: string) {
  switch (entityType) {
    case "ORGANIZATION":
      return prisma.organization.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
      });
    case "PERSON":
      return prisma.person.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
      });
    case "POSITION":
      return prisma.position.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
      });
    case "POSITION_ASSIGNMENT":
      return prisma.positionAssignment.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
      });
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // A stored date against the payload's ISO string: compare the instants.
  if (a instanceof Date && typeof b === "string") return a.getTime() === Date.parse(b);
  if (typeof a === "string" && b instanceof Date) return Date.parse(a) === b.getTime();
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}
