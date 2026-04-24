# Server hardening (Phase 13)

Phase 13 adds the operational plumbing every production deploy needs: structured logs, correlation IDs, rate limiting, Sentry, and a shutdown-hook registry. It also completed the logger sweep — every `console.info/warn/error/debug` in server-only code from phases 6–12 was replaced with `logger.info/warn/error/debug`.

## Logger

`~/utils/monitoring/logger.server.ts` — pino instance used throughout the app code (services, loaders, actions, utilities). Pretty-prints in development, structured JSON in production, with a redaction list covering auth headers / secrets / session ids. Shape:

```ts
import { logger } from "~/utils/monitoring/logger.server";
logger.info({ userId, tenantId }, "user signed in");
logger.error({ err, ctx }, "something broke");
```

`server/logger.js` — parallel JS copy used by the Express boot file. Same config.

Env knobs: `LOG_LEVEL` (defaults `info`), `APP_NAME`, `APP_VERSION`, `NODE_ENV`.

## Correlation IDs

`server/correlation.js` + `app/middleware/correlation.server.ts` — an `AsyncLocalStorage<RequestContext>` shared across both sides of the server. Middleware reads upstream `x-correlation-id` / `x-request-id` or mints a UUIDv4. Every response carries `x-correlation-id` so clients can pivot.

From inside a loader / action / service, use `getRequestLogger()` to get a correlation-bound child logger:

```ts
import { getRequestLogger } from "~/middleware/correlation.server";
const log = getRequestLogger();
log.info({ action: "create" }, "creating record"); // automatically tagged with correlationId
```

## Request logger

`server/request-logger.js` — logs `incoming request` on arrival and `request completed` on finish. Skips Vite/HMR assets, favicons, service worker, SSE long-polls, and icon paths. Log level auto-scales to request status: `info` for 2xx/3xx, `warn` for 4xx, `error` for 5xx.

## CORS

`server/security.ts` ships a `corsMiddleware` configured from `CORS_ORIGINS` (comma-separated, defaults to `http://localhost:3000`). Allows: `X-CSRF-Token`, `X-API-Key`, `If-Match`, `Idempotency-Key`, `X-Correlation-Id`, `X-Request-Id`. Credentials mode is on.

## Rate limiting

Three pre-configured limiters in `server/security.ts`:

| Name              | Window | Limit | Scope                      | Mounted                                                 |
| ----------------- | ------ | ----- | -------------------------- | ------------------------------------------------------- |
| `generalLimiter`  | 15 min | 300   | Every request              | Globally via `app.use(generalLimiter)` in server/app.ts |
| `mutationLimiter` | 1 min  | 50    | POST/PUT/PATCH/DELETE only | Not mounted — apps mount where needed                   |
| `authLimiter`     | 1 min  | 10    | Every request              | Not mounted — apps mount on `/login`, `/signup`, etc.   |

Limits are keyed per-user when authenticated, per-IP otherwise. Health checks (`/up`, `/healthz`) are skipped. Override `generalLimiter` via `RATE_LIMIT_WINDOW_MS` + `RATE_LIMIT_MAX_REQUESTS` env vars.

## Rate-limit audit

`server/rate-limit-audit.ts` — every 429 appends to an in-process buffer that flushes every 5 s or at 50 entries, writing a `RATE_LIMIT` row to `AuditLog`. The flush timer uses `.unref()`; the shutdown hook does one last flush.

## Sentry

- `~/utils/monitoring/sentry.server.ts` — `@sentry/node` wrapper with `captureException`, `captureMessage`, `setUser`. No-ops when `SENTRY_DSN` is unset.
- `~/utils/monitoring/sentry.client.ts` — `@sentry/browser` wrapper plus `initSentryClient(dsn)`. `root.tsx` invokes it in an effect with the DSN from `window.ENV.SENTRY_DSN`.
- `server/sentry.js` — boot-time init. **Must** be imported at the very top of `server/app.ts` because `@sentry/node` patches global `http` / `fetch` on `init()`.

Context propagation: pass `{ correlationId, tenantId, userId }` to `captureException` — they become tags (correlationId, tenantId) and user (userId); everything else goes into extras.

## Graceful shutdown

`server/shutdown.js` — small hook registry. Any subsystem that needs cleanup registers itself:

```ts
import { onShutdown } from "./shutdown.js";
onShutdown(() => redis.quit());
onShutdown(async () => await queueDrainer.drain());
```

A single `SIGTERM` / `SIGINT` handler in `server/app.ts` runs every hook in registration order, awaits async ones, swallows individual failures, and exits cleanly. Phase 13 registers two hooks by default: `flushRateLimitBuffer` + `stopJobProcessor`.

## Env additions

`env.server.ts` gained these optional vars (boot succeeds without them):

- `APP_NAME`, `APP_VERSION` — logger + Sentry `service` / `release` tags.
- `LOG_LEVEL` — pino level (`fatal` | `error` | `warn` | `info` | `debug` | `trace`).
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` — Sentry (both sides).
- `CORS_ORIGINS` — comma-separated allowlist.
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` — override general limiter.

`getEnv()` now also surfaces `SENTRY_DSN` so the client Sentry init can read it from `window.ENV`.

## Logger sweep

Every `console.info/warn/error/debug` in server-only files from phases 6–12 got rewritten to `logger.*`. 8 files touched:

- `app/services/sso.server.ts`, `app/services/webhook-delivery.server.ts`, `app/services/webhook-dispatcher.server.ts`
- `app/utils/auth/audit.server.ts`, `app/utils/auth/sso-state.server.ts`
- `app/utils/events/job-handlers.server.ts`, `app/utils/events/job-queue.server.ts`, `app/utils/events/webhook-emitter.server.ts`

Files outside `app/` (namely `public/sw.js` and `tests/**`) were deliberately NOT touched.

## Deviations

- **Migration baseline skipped.** Template continues to ship with `db push`.
- **No helmet wiring.** Template ships `@nichtsam/helmet` as a dep but `server/app.ts` doesn't apply it. A production-grade CSP needs app-specific decisions about `unsafe-inline`, worker-src, blob:, and nonce plumbing.
- **No suspicious-request blocker.** Aggressive and false-positive-prone in dev.
- **No `/healthz` / `/up` route.** `skipHealthCheck` in the rate limiter handles both paths, but no actual route is mounted.
- **Sentry replay not wired.** Client init references sample rates but the `Replay` integration isn't installed.
- **`mutationLimiter` and `authLimiter` are not mounted.** Apps mount them where appropriate.
- **Rate-limit buffer is in-process.** Not Redis-backed. Multi-process deploys need `rate-limit-redis`.
- **Request-logger skiplist is hand-curated.** Apps adding high-traffic endpoints should add patterns to `request-logger.js`.
- **`trust proxy` is hardcoded to `1`.** Multi-hop deployments bump this; same-host deploys set it to `false`.
- **`public/sw.js` keeps `console.*`** — it runs outside the bundler.
- **Suspicious-request blocker, nonce middleware, permissions-policy header, and a hardened helmet CSP are intentionally NOT shipped.**
