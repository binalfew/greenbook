import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

// Boot-time Sentry init for the Express process. Must be imported at the
// very top of server/app.ts before any other code runs — @sentry/node
// patches the global fetch / http modules when init() runs, and anything
// that uses those before init happens won't get instrumented.

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION || "dev",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,

    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },

    ignoreErrors: ["AbortError", "Response.redirect", /Navigation cancelled/, /Navigating to/],
  });

  logger.info("Sentry error tracking initialized");
} else {
  logger.debug("Sentry disabled (SENTRY_DSN not set)");
}

/**
 * Capture an exception with optional multi-tenant context.
 * No-ops when SENTRY_DSN is not configured.
 *
 * @param {unknown} error
 * @param {{ correlationId?: string; tenantId?: string; userId?: string; [key: string]: unknown }} [context]
 */
export function captureException(error, context) {
  if (!dsn) return;

  Sentry.withScope((scope) => {
    if (context) {
      if (context.correlationId) scope.setTag("correlationId", String(context.correlationId));
      if (context.tenantId) scope.setTag("tenantId", String(context.tenantId));
      if (context.userId) scope.setUser({ id: String(context.userId) });

      const { correlationId, tenantId, userId, ...extra } = context;
      scope.setExtras(extra);
    }
    Sentry.captureException(error);
  });
}

/**
 * @param {string} message
 * @param {"info" | "warning" | "error"} [level="info"]
 */
export function captureMessage(message, level = "info") {
  if (!dsn) return;
  Sentry.captureMessage(message, level);
}

export { Sentry };
