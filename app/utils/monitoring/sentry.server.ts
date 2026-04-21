/**
 * Server-side Sentry integration for app code (loaders, actions, services).
 *
 * All exports gracefully no-op when SENTRY_DSN is not configured so callers
 * never need to check whether Sentry is enabled before calling.
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
const isEnabled = Boolean(dsn);

// Initialize only if not already done by server/sentry.js (idempotent).
// Sentry itself dedupes init calls, but we guard explicitly so this module
// can also be imported independently in tests.
if (isEnabled && !Sentry.getClient()) {
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
}

/**
 * Capture an exception with optional multi-tenant context.
 * No-ops when SENTRY_DSN is empty or missing.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!isEnabled) return;

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
 * Capture a message at a specific severity level.
 * No-ops when SENTRY_DSN is empty or missing.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (!isEnabled) return;
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for all subsequent Sentry events in this scope.
 * Useful when authenticating a request in a loader/action.
 */
export function setUser(user: { id: string; email?: string } | null): void {
  if (!isEnabled) return;
  Sentry.setUser(user);
}

export { Sentry, isEnabled as isSentryEnabled };
