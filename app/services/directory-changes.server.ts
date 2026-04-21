import type { ChangeRequest, Prisma } from "~/generated/prisma/client.js";
import { writeAudit } from "~/utils/auth/audit.server";
import { prisma } from "~/utils/db/db.server";
import { emitDomainEvent } from "~/utils/events/emit-domain-event.server";
import { logger } from "~/utils/monitoring/logger.server";
import {
  payloadSchemaFor,
  type ChangeOperationKey,
  type DirectoryEntityKey,
} from "~/utils/schemas/directory";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

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
export type BatchItemSkip = { id: string; reason: "NOT_PENDING" | "NOT_FOUND" };

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
  await assertNoPendingConflict(ctx.tenantId, input.entityType, input.entityId);

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

  const change = await prisma.changeRequest.create({
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

  emitDomainEvent(ctx.tenantId, "change.submitted", {
    id: change.id,
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    submittedById: change.submittedById,
  });

  return change;
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

function domainEventFor(entityType: DirectoryEntityKey, operation: ChangeOperationKey): string {
  const entity = entityType === "POSITION_ASSIGNMENT" ? "position" : entityType.toLowerCase();
  if (entityType === "POSITION_ASSIGNMENT") {
    if (operation === "CREATE") return "position.assigned";
    if (operation === "DELETE" || operation === "UPDATE") return "position.ended";
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
  if (!change) throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
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
      data: {
        status: "APPROVED",
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
        appliedAt: new Date(),
        reviewerNotes: notes ?? null,
        entityId: entity.id,
      },
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
  if (!change) throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
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

  const updated = await prisma.changeRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
      reviewerNotes: notes,
    },
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

  return updated;
}

// ─── Withdraw ───────────────────────────────────────────────────────────

export async function withdrawChange(id: string, ctx: TenantServiceContext) {
  const change = await prisma.changeRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!change) throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
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

  const updated = await prisma.changeRequest.update({
    where: { id },
    data: { status: "WITHDRAWN", reviewedAt: new Date() },
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
  await assertNoPendingConflict(ctx.tenantId, input.entityType, input.entityId);

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

  emitDomainEvent(ctx.tenantId, domainEventFor(input.entityType, input.operation), {
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
  verb: "approved" | "rejected" | "withdrawn",
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
        if (error.code === "NOT_PENDING") {
          result.skipped.push({ id, reason: "NOT_PENDING" });
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
    ...(where.status
      ? { status: where.status as "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" }
      : {}),
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

export async function getChange(id: string, tenantId: string) {
  const change = await prisma.changeRequest.findFirst({
    where: { id, tenantId },
    include: changeListInclude,
  });
  if (!change) throw new ChangeRequestError("Change request not found", 404, "NOT_FOUND");
  return change;
}

// ─── Diff ───────────────────────────────────────────────────────────────

export type FieldDiff = {
  field: string;
  before: unknown;
  after: unknown;
};

export async function computeDiff(change: ChangeRequest): Promise<FieldDiff[]> {
  if (change.operation === "CREATE") {
    // No "before" — every field in the payload is a new value.
    const payload = change.payload as Record<string, unknown> | null;
    if (!payload) return [];
    return Object.entries(payload).map(([field, after]) => ({
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
    const before = (live as Record<string, unknown>)[field];
    const after = payload[field];
    if (!deepEqual(before, after)) {
      diffs.push({ field, before: before ?? null, after });
    }
  }
  return diffs;
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
