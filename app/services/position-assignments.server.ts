import type { Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import { logger } from "~/utils/monitoring/logger.server";
import type { PositionAssignmentPayload } from "~/utils/schemas/directory";
import type { TenantServiceContext } from "~/utils/types.server";

type Db = Prisma.TransactionClient | typeof prisma;

// Position Assignments — the temporal link between a Person and a Position.
//
// Invariants:
// - On CREATE, any existing `isCurrent` assignment for the same position is
//   auto-closed (endDate := startDate of the new assignment, isCurrent := false).
// - On UPDATE, if `endDate` is set, `isCurrent` is auto-flipped to false.
// - Soft-delete via deletedAt; history survives.

export class PositionAssignmentError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "PositionAssignmentError";
    this.status = status;
    this.code = code;
  }
}

const assignmentSelect = {
  id: true,
  tenantId: true,
  positionId: true,
  personId: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  notes: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────

export async function listAssignmentHistory(positionId: string, tenantId: string) {
  return prisma.positionAssignment.findMany({
    where: { positionId, tenantId, deletedAt: null },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
    include: {
      person: {
        select: { id: true, firstName: true, lastName: true, honorific: true },
      },
    },
  });
}

export async function listCurrentAssignmentsForPerson(personId: string, tenantId: string) {
  return prisma.positionAssignment.findMany({
    where: { personId, tenantId, deletedAt: null, isCurrent: true },
    orderBy: { startDate: "desc" },
    include: {
      position: {
        select: {
          id: true,
          title: true,
          organization: { select: { id: true, name: true, acronym: true } },
        },
      },
    },
  });
}

export async function getAssignment(id: string, tenantId: string) {
  const row = await prisma.positionAssignment.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      position: {
        select: {
          id: true,
          title: true,
          organization: { select: { id: true, name: true } },
        },
      },
      person: {
        select: { id: true, firstName: true, lastName: true, honorific: true },
      },
    },
  });
  if (!row) {
    throw new PositionAssignmentError("Assignment not found", 404, "NOT_FOUND");
  }
  return row;
}

// ─── Guards ─────────────────────────────────────────────────────────────

async function assertReferencedPosition(positionId: string, tenantId: string, db: Db) {
  const row = await db.position.findFirst({
    where: { id: positionId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new PositionAssignmentError(
      "Referenced position is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

async function assertReferencedPerson(personId: string, tenantId: string, db: Db) {
  const row = await db.person.findFirst({
    where: { id: personId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new PositionAssignmentError(
      "Referenced person is not available",
      400,
      "REFERENCED_RECORD_NOT_PUBLISHED",
    );
  }
}

// ─── Internal writers ───────────────────────────────────────────────────
//
// Writers accept an optional `tx` and fall back to the global prisma client.
// The approval pipeline always passes `tx` so the auto-close + create are
// atomic with the ChangeRequest update. Tests and future non-approval
// callers can omit `tx` — a local helper opens one on their behalf.

async function createAssignmentInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  payload: PositionAssignmentPayload,
) {
  const newStart = new Date(payload.startDate);
  const newEnd = payload.endDate ? new Date(payload.endDate) : null;
  const isCurrent = !newEnd;

  if (isCurrent) {
    // Auto-close any existing current assignment on the same position.
    await tx.positionAssignment.updateMany({
      where: {
        tenantId,
        positionId: payload.positionId,
        deletedAt: null,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
        endDate: newStart,
        version: { increment: 1 },
      },
    });
  }

  return tx.positionAssignment.create({
    data: {
      tenantId,
      positionId: payload.positionId,
      personId: payload.personId,
      startDate: newStart,
      endDate: newEnd,
      isCurrent,
      notes: payload.notes ?? null,
    },
    select: assignmentSelect,
  });
}

export async function _applyCreateAssignment(
  tenantId: string,
  payload: PositionAssignmentPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  await assertReferencedPosition(payload.positionId, tenantId, db);
  await assertReferencedPerson(payload.personId, tenantId, db);

  logger.info(
    { tenantId, userId: ctx.userId, positionId: payload.positionId, personId: payload.personId },
    "applying CREATE position assignment",
  );

  if (tx) return createAssignmentInTx(tx, tenantId, payload);
  return prisma.$transaction((inner) => createAssignmentInTx(inner, tenantId, payload));
}

export async function _applyUpdateAssignment(
  id: string,
  tenantId: string,
  payload: PositionAssignmentPayload,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.positionAssignment.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throw new PositionAssignmentError("Assignment not found", 404, "NOT_FOUND");
  }

  await assertReferencedPosition(payload.positionId, tenantId, db);
  await assertReferencedPerson(payload.personId, tenantId, db);

  const startDate = new Date(payload.startDate);
  const endDate = payload.endDate ? new Date(payload.endDate) : null;
  const isCurrent = !endDate;

  logger.info(
    { tenantId, userId: ctx.userId, assignmentId: id },
    "applying UPDATE position assignment",
  );

  return db.positionAssignment.update({
    where: { id },
    data: {
      positionId: payload.positionId,
      personId: payload.personId,
      startDate,
      endDate,
      isCurrent,
      notes: payload.notes ?? null,
      version: { increment: 1 },
    },
    select: assignmentSelect,
  });
}

export async function _applySoftDeleteAssignment(
  id: string,
  tenantId: string,
  ctx: TenantServiceContext,
  tx?: Prisma.TransactionClient,
) {
  const db: Db = tx ?? prisma;
  const existing = await db.positionAssignment.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throw new PositionAssignmentError("Assignment not found", 404, "NOT_FOUND");
  }

  logger.info(
    { tenantId, userId: ctx.userId, assignmentId: id },
    "applying DELETE position assignment",
  );

  return db.positionAssignment.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: assignmentSelect,
  });
}
