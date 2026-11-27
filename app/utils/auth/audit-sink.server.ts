import fs from "node:fs";

import { logger } from "~/utils/monitoring/logger.server";

// External audit sink.
//
// Post-demo requirement: app audit logs should be persisted outside the
// database. This module ships each audit record as a single structured JSON
// line to a dedicated stream (stdout by default, or a file) that an external
// log shipper — Loki, ELK, Datadog, CloudWatch, an S3 archive via Fluent Bit,
// etc. — can pick up and retain independently of Postgres.
//
// Sink selection (env `AUDIT_SINK`):
//   - "both"     (default) → write to the DB *and* emit externally
//   - "external"           → emit externally only (skip the DB write)
//   - "db"                 → DB only (external emission disabled)
//
// External destination:
//   - `AUDIT_LOG_FILE` set → append newline-delimited JSON to that file
//   - otherwise            → emit on stdout via the app logger, tagged
//                            `logType: "audit"` for downstream routing
//
// Every function here is best-effort and never throws — an audit sink must
// not break the caller flow.

export type AuditSinkMode = "both" | "external" | "db";

export function getAuditSinkMode(): AuditSinkMode {
  const raw = (process.env.AUDIT_SINK || "both").trim().toLowerCase();
  if (raw === "external" || raw === "db" || raw === "both") return raw;
  return "both";
}

export function shouldWriteAuditToDb(): boolean {
  return getAuditSinkMode() !== "external";
}

export function isExternalAuditEnabled(): boolean {
  return getAuditSinkMode() !== "db";
}

export interface AuditRecord {
  tenantId: string | null;
  userId: string | null;
  actingAsUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}

// Lazily-opened file stream, memoised across calls. Kept as `unknown` +
// duck-typed `write` so this module has no hard dependency on pino's types
// when the file path is unset (the common stdout case).
type WritableLike = { write(chunk: string): void };
let fileStream: WritableLike | null | undefined;

function getFileStream(): WritableLike | null {
  if (fileStream !== undefined) return fileStream;

  const path = process.env.AUDIT_LOG_FILE?.trim();
  if (!path) {
    fileStream = null;
    return null;
  }

  try {
    // Append stream, opened once and memoised for the process lifetime.
    fileStream = fs.createWriteStream(path, { flags: "a" });
    return fileStream;
  } catch (error) {
    logger.warn({ err: error, path }, "audit sink: failed to open AUDIT_LOG_FILE; using stdout");
    fileStream = null;
    return null;
  }
}

// Emit a single audit record to the configured external destination.
// No-op when the sink mode is DB-only. Never throws.
export function emitAuditExternal(record: AuditRecord): void {
  if (!isExternalAuditEnabled()) return;

  try {
    const stream = getFileStream();
    if (stream) {
      const line = JSON.stringify({
        logType: "audit",
        time: new Date().toISOString(),
        ...record,
      });
      stream.write(`${line}\n`);
      return;
    }

    // stdout path — go through the app logger so it inherits the
    // service/version/environment base fields and JSON formatting.
    logger.info({ logType: "audit", audit: record }, "audit");
  } catch (error) {
    logger.warn({ err: error }, "audit sink: external emit failed");
  }
}
