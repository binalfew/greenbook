/**
 * Client-side Sentry integration.
 *
 * Initialization is deferred until the root loader provides the SENTRY_DSN,
 * which is called via `initSentryClient()` in a useEffect in root.tsx.
 */
import * as Sentry from "@sentry/browser";

let initialized = false;

/**
 * Initialize Sentry in the browser.
 * Safe to call multiple times; subsequent calls are ignored.
 * If dsn is falsy, initialization is skipped entirely.
 */
export function initSentryClient(dsn: string | undefined): void {
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

    // Session replay sampling — requires @sentry/browser replay integration
    // to be loaded if the app opts in. Zero cost when integrations are absent.
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,

    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },

    ignoreErrors: [
      "AbortError",
      "Response.redirect",
      // React Router navigation-related errors that are not actionable
      /Navigation cancelled/,
      /Navigating to/,
      // Common browser noise
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      /Loading chunk \d+ failed/,
    ],
  });

  initialized = true;
}

/** Capture an exception on the client side. No-ops before init. */
export function captureException(error: unknown): void {
  if (!initialized) return;
  Sentry.captureException(error);
}

/** Capture a message on the client side. No-ops before init. */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

export { Sentry };
