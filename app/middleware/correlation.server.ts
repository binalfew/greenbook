import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { logger } from "~/utils/monitoring/logger.server";

// App-side mirror of server/correlation.js — same AsyncLocalStorage
// semantics, but typed and co-located with the app's logger so loaders
// and actions can pull a correlation-scoped child logger.
// Note: because Node spawns only one ALS per process, the two modules
// share the same runtime context at request time (imports dedupe via
// the `node:async_hooks` singleton).

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  userId?: string;
  requestPath: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getCorrelationId(): string {
  return asyncLocalStorage.getStore()?.correlationId ?? "no-correlation-id";
}

/**
 * Returns a child logger bound to the current correlation ID.
 * Falls back to the root logger when no correlation context exists
 * (e.g. boot-time or test code outside a request).
 */
export function getRequestLogger() {
  const context = getRequestContext();
  if (context) {
    return logger.child({ correlationId: context.correlationId });
  }
  return logger;
}

export function correlationMiddleware(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    crypto.randomUUID();

  const context: RequestContext = {
    correlationId,
    requestPath: req.path,
  };

  res.setHeader("x-correlation-id", correlationId);

  asyncLocalStorage.run(context, () => {
    next();
  });
}
