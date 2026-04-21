// Sentry MUST init before anything else so @sentry/node can patch
// global http/fetch before any other module uses them.
import "./sentry.js";
import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
// Side-effect import — registers send-email and other job handlers on the
// in-process job queue. Must happen before startJobProcessor() runs.
import "~/utils/events/job-handlers.server";
import { startJobProcessor, stopJobProcessor } from "~/utils/events/job-queue.server";
import { correlationMiddleware } from "./correlation.js";
import { logger } from "./logger.js";
import { requestLogger } from "./request-logger.js";
import { corsMiddleware, extractSessionUser, generalLimiter } from "./security.js";
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
// 3. CORS before rate limiting so preflight OPTIONS isn't counted.
// 4. Session extraction before rate limiting so keys are per-user when authed.
// 5. General rate limiter last — covers every subsequent request.
app.use(correlationMiddleware);
app.use(requestLogger);
app.use(corsMiddleware);

// Lazy-load the session helper so rate-limit extraction doesn't pull in
// the entire app bundle before Vite is ready.
app.use(
  extractSessionUser(async (request) => {
    const { authSessionStorage } = await import("~/utils/auth/session.server");
    return authSessionStorage.getSession(request.headers.get("cookie"));
  }),
);

app.use(generalLimiter);

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

// ─── Job processor ───────────────────────────────────────
// Single-instance, in-process job queue. Started once per Node process.
// The startJobProcessor guard is idempotent under Vite HMR.
startJobProcessor(5000);

// Register shutdown hooks — flush audit buffer + stop job processor.
// Any additional subsystems (redis, tracing exporters, etc.) add themselves
// via onShutdown(fn) so the single SIGTERM/SIGINT handler drains everything.
onShutdown(() => {
  flushRateLimitBuffer();
});
onShutdown(() => {
  stopJobProcessor();
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
