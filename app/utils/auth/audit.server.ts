import { prisma } from "~/utils/db/db.server";
import { logger } from "~/utils/monitoring/logger.server";
import { emitAuditExternal, shouldWriteAuditToDb } from "./audit-sink.server";
import { extractClientIp } from "./ip-utils.server";

type WriteAuditParams = {
  tenantId?: string | null;
  userId?: string | null;
  actingAsUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: Request;
};

export async function writeAudit(p: WriteAuditParams): Promise<void> {
  const record = {
    tenantId: p.tenantId ?? null,
    userId: p.userId ?? null,
    actingAsUserId: p.actingAsUserId ?? null,
    action: p.action,
    entityType: p.entityType,
    entityId: p.entityId ?? null,
    description: p.description ?? null,
    metadata: (p.metadata ?? null) as Record<string, unknown> | null,
    ipAddress: p.request ? extractClientIp(p.request) : null,
    userAgent: p.request ? (p.request.headers.get("user-agent") ?? null) : null,
  };

  // Ship the record to the external sink (stdout/file → external log store)
  // so the audit trail persists outside the DB. Best-effort, never throws.
  emitAuditExternal(record);

  // The DB write is skipped when the sink is configured external-only.
  if (!shouldWriteAuditToDb()) return;

  try {
    await prisma.auditLog.create({
      data: {
        ...record,
        metadata: record.metadata as object | undefined,
      },
    });
  } catch (error) {
    // Audit failures must not break caller flow
    logger.warn({ err: error }, "writeAudit failed");
  }
}
