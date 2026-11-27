// Sentry MUST init before anything else so @sentry/node can patch
// global http/fetch before any other module uses them.
import "./sentry.js";
import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import { correlationMiddleware } from "./correlation.js";
import { logger } from "./logger.js";
import { requestLogger } from "./request-logger.js";
import {
  AUTH_LIMITED_PATHS,
  authLimiter,
  corsMiddleware,
  extractSessionUser,
  generalLimiter,
  mutationLimiter,
  requireSameOrigin,
  searchLimiter,
} from "./security.js";
import { flushRateLimitBuffer } from "./rate-limit-audit.js";
import { onShutdown, runShutdownHooks } from "./shutdown.js";

declare module "react-router" {
  interface AppLoadContext {
    VALUE_FROM_EXPRESS: string;
  }
}

export const app = express();

// Trust proxy so req.ip reflects the original client behind load balancers.
// Adjust the hop count to match your deployment (1 = one proxy in front).
app.set("trust proxy", 1);

// ─── Observability middleware (order matters) ───────────
// 1. Correlation ID first so every downstream log/audit line can pivot on it.
// 2. Request logger second so it captures the correlation ID.
// 3. CORS before rate limiting so preflight OPTIONS isn't counted, then the
//    same-origin check so forged writes are refused before any work is done.
// 4. Session extraction before rate limiting so keys are per-user when authed.
// 5. General rate limiter last — covers every subsequent request.
app.use(correlationMiddleware);
app.use(requestLogger);
app.use(corsMiddleware);
app.use(requireSameOrigin);

// Lazy-load the session helper so rate-limit extraction doesn't pull in
// the entire app bundle before Vite is ready.
app.use(
  extractSessionUser(async (request) => {
    const { authSessionStorage } = await import("~/utils/auth/session.server");
    return authSessionStorage.getSession(request.headers.get("cookie"));
  }),
);

app.use(generalLimiter);

// Writes get a per-minute cap on top of the general budget, and credential
// submissions a tighter one still, so passwords and reset codes can't be
// guessed at the general rate.
app.use(mutationLimiter);
app.use(AUTH_LIMITED_PATHS, authLimiter);

// Tighter cap on the directory search type-ahead — mounted before the
// general handler so it only governs the search endpoint. Both spellings are
// listed because Express matches mount paths on segment boundaries:
// "/api/search-people" alone does NOT cover "/api/search-people.data", the
// URL React Router uses for fetcher/single-fetch loads, which would otherwise
// reach the same loader unthrottled.
app.use(["/api/search-people", "/api/search-people.data"], searchLimiter);

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext() {
      return {
        VALUE_FROM_EXPRESS: "Hello from Express",
      };
    },
  }),
);

// Register shutdown hooks — flush the audit buffer.
// Any additional subsystems (redis, tracing exporters, etc.) add themselves
// via onShutdown(fn) so the single SIGTERM/SIGINT handler drains everything.
onShutdown(() => {
  flushRateLimitBuffer();
});

let shuttingDown = false;
async function handleShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ msg: "shutdown signal received", signal });
  await runShutdownHooks();
  logger.info({ msg: "shutdown hooks completed, exiting" });
  process.exit(0);
}
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
