import { prisma } from "~/utils/db/db.server";
import { logger } from "~/utils/monitoring/logger.server";
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
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: p.tenantId ?? null,
        userId: p.userId ?? null,
        actingAsUserId: p.actingAsUserId ?? null,
        action: p.action,
        entityType: p.entityType,
        entityId: p.entityId ?? null,
        description: p.description ?? null,
        metadata: p.metadata as object | undefined,
        ipAddress: p.request ? extractClientIp(p.request) : null,
        userAgent: p.request ? (p.request.headers.get("user-agent") ?? null) : null,
      },
    });
  } catch (error) {
    // Audit failures must not break caller flow
    logger.warn({ err: error }, "writeAudit failed");
  }
}
