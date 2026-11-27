import type { Request, Response } from "express";
import { emitAuditExternal, shouldWriteAuditToDb } from "~/utils/auth/audit-sink.server";
import { prisma } from "~/utils/db/db.server";

// Batched rate-limit-violation writer. Each 429 from express-rate-limit
// appends to an in-process buffer which flushes every 5s or at 50 entries,
// whichever comes first. Keeps the audit trail without hammering the DB
// under sustained abuse.

export interface ViolationContext {
  userId: string | null;
  ip: string;
  path: string;
  method: string;
  tier: string;
  limit: number;
  userAgent: string;
}

export function extractViolationContext(
  req: Request,
  res: Response,
  tier: string,
  limit: number,
): ViolationContext {
  return {
    userId: (res.locals.userId as string) || null,
    ip: req.ip || req.socket.remoteAddress || "unknown",
    path: req.path,
    method: req.method,
    tier,
    limit,
    userAgent: req.headers["user-agent"] || "",
  };
}

const buffer: ViolationContext[] = [];
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 50;

export function logRateLimitViolation(context: ViolationContext): void {
  buffer.push(context);
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushRateLimitBuffer();
  }
}

export function flushRateLimitBuffer(): void {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0);

  // Ship each violation to the external audit sink (stdout/file) so the
  // rate-limit trail persists outside the DB alongside the rest of the audit
  // log. Best-effort, never throws.
  for (const ctx of batch) {
    emitAuditExternal({
      tenantId: null,
      userId: ctx.userId,
      actingAsUserId: null,
      action: "RATE_LIMIT",
      entityType: "RateLimit",
      entityId: ctx.tier,
      description: null,
      metadata: {
        ip: ctx.ip,
        path: ctx.path,
        method: ctx.method,
        tier: ctx.tier,
        limit: ctx.limit,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  if (!shouldWriteAuditToDb()) return;

  prisma.auditLog
    .createMany({
      data: batch.map((ctx) => ({
        userId: ctx.userId,
        action: "RATE_LIMIT",
        entityType: "RateLimit",
        entityId: ctx.tier,
        metadata: {
          ip: ctx.ip,
          path: ctx.path,
          method: ctx.method,
          tier: ctx.tier,
          limit: ctx.limit,
        },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      })),
    })
    .catch(() => {
      // Audit writes are best-effort — never block rate-limit responses.
    });
}

// Periodically flush any buffered violations. `.unref()` so the timer
// never holds the Node event loop open at shutdown.
const flushInterval = setInterval(flushRateLimitBuffer, FLUSH_INTERVAL_MS);
flushInterval.unref();
