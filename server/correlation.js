import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

/** @typedef {{ correlationId: string; tenantId?: string; userId?: string; requestPath: string }} RequestContext */

// AsyncLocalStorage instance shared across the Express and React Router
// sides of the server — any loader/action running inside a request can
// retrieve the correlation ID without plumbing it through arguments.
export const asyncLocalStorage = new AsyncLocalStorage();

/** @returns {RequestContext | undefined} */
export function getRequestContext() {
  return asyncLocalStorage.getStore();
}

/** @returns {string} */
export function getCorrelationId() {
  return asyncLocalStorage.getStore()?.correlationId ?? "no-correlation-id";
}

/**
 * Express middleware that attaches a correlation ID to every request.
 * Honours `x-correlation-id` or `x-request-id` upstream headers so
 * requests from load balancers / gateways keep their ID. Falls back
 * to a fresh UUIDv4 when neither is present.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function correlationMiddleware(req, res, next) {
  const rawId = req.headers["x-correlation-id"] || req.headers["x-request-id"];
  const correlationId = (Array.isArray(rawId) ? rawId[0] : rawId) || crypto.randomUUID();

  /** @type {RequestContext} */
  const context = {
    correlationId,
    requestPath: req.path,
  };

  res.setHeader("x-correlation-id", correlationId);

  asyncLocalStorage.run(context, () => {
    next();
  });
}
