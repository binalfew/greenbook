# Phase 6 — Events & Jobs Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the eventing, background-jobs, and webhook infrastructure the template has been promising since Phase 0. By the end of this phase: (1) an in-process job queue with a handler registry and exponential backoff processes `send-email` and `webhook-delivery` jobs on a 5-second interval; (2) a domain-event emitter fans events out to SSE (real-time UI) and webhooks (external consumers); (3) webhook subscriptions can be CRUD'd at `/$tenant/settings/integrations/webhooks`, with HMAC-signed deliveries, retry with backoff, and a circuit breaker; (4) per-user notifications are created via a service, delivered in real-time via SSE, and listed at `/$tenant/notifications`; (5) a notification bell in the tenant top-nav reveals unread count and recent items; (6) an idempotency helper for write API endpoints; (7) the job processor starts on server boot and stops gracefully on shutdown. Webhook event types are scoped to the template's surface (`user.*`, `role.*`, `tenant.*`, `settings.*`, `api_key.*`) — FMS-specific events (asset, work_order) stay in facilities.

**Architecture (what arrives in this phase):**

- **Prisma models:** `Job`, `IdempotencyKey`, `Notification`, `WebhookSubscription`, `WebhookDelivery` + three enums (`JobStatus`, `WebhookStatus`, `DeliveryStatus`).
- **Job queue** (`app/utils/events/job-queue.server.ts`): handler registry via `registerJobHandler(type, handler)`, `enqueueJob(type, payload, opts?)`, atomic `FOR UPDATE SKIP LOCKED` claim via raw SQL, exponential-backoff retry (2^attempts × 30s + up to 30% jitter, capped 1h), `startJobProcessor()` / `stopJobProcessor()`.
- **Job handlers** (`app/utils/events/job-handlers.server.ts`): `send-email` (delegates to `sendEmail` from Phase 0 email infra), `webhook-delivery` (delegates to `deliverWebhook`). No FMS handlers — those stay in facilities. The template seeds an empty-but-importable file that registers these two handlers and nothing else.
- **Domain event emitter** (`app/utils/events/emit-domain-event.server.ts`): fire-and-forget helper that emits to SSE and webhooks in one call. Used from services (e.g., `user.created` → emitted from `createUser`).
- **Webhook emitter** (`app/utils/events/webhook-emitter.server.ts`): feature-flag-gated (`FF_WEBHOOKS`, seeded in Phase 3), generates event IDs, delegates to dispatcher.
- **Webhook catalog** (`app/utils/events/webhook-events.ts`): type-safe event name union + `validateEventTypes(events)` + `getEventsByDomain()` for the subscription UI. Scoped to `user.*`, `role.*`, `tenant.*`, `settings.*`, `api_key.*`, `invitation.*`.
- **Webhook services:**
  - `app/services/webhooks.server.ts` — subscription CRUD, status transitions (ACTIVE / PAUSED / DISABLED / SUSPENDED), secret rotation.
  - `app/services/webhook-dispatcher.server.ts` — finds subscriptions matching an event (including `*` wildcard), creates `WebhookDelivery` rows, enqueues `webhook-delivery` jobs.
  - `app/services/webhook-delivery.server.ts` — HMAC-SHA256 signing, timeout, status codes → retry or circuit-break, `consecutiveFailures` tracking, auto-suspend after threshold.
- **Notification service** (`app/services/notifications.server.ts`): `createNotification`, `getUnreadCount`, `listNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`. Creating emits SSE.
- **Idempotency helper** (`app/utils/events/idempotency.server.ts` — NEW, not in facilities as a dedicated util): `withIdempotency(request, response, handler)` + a small wrapper for API routes. Reads `Idempotency-Key` header, uniqueness scoped by `(key, tenantId)`, returns cached response if present, persists on success, 24h TTL.
- **SSE** (`server/sse.ts` + `app/routes/$tenant/api/events.tsx` + `app/hooks/use-sse.ts`): `EventEmitter`-backed in-process bus, per-tenant filtering, per-user filtering when `userId` set, 30s heartbeat, auto-cleanup on client disconnect.
- **Notification UI:**
  - `app/components/notification-bell.tsx` — top-nav icon with unread badge, dropdown list.
  - `app/components/notification-listener.tsx` — wraps `useSSE` to push toasts + revalidate loaders.
  - `app/routes/$tenant/notifications/` — list + read/unread toggles + delete.
- **Webhook admin UI** (`app/routes/$tenant/settings/integrations/webhooks/`): list, new, detail (shows deliveries), edit, delete, rotate-secret.
- **Server boot** (`server/app.ts`): call `startJobProcessor(5000)` after the HTTP server mounts; call `stopJobProcessor()` in the graceful-shutdown handler. Import `job-handlers.server.ts` once to register handlers.
- **Translations:** new namespace `notifications.json` is already in Phase 4; fill it out this phase. Add `webhooks.json` for the admin UI.

**Tech stack touched:** `prisma/schema.prisma` (+5 models, +3 enums), `prisma/seed.ts` (seed one sample webhook subscription per tenant behind `FF_WEBHOOKS` so the admin UI has data), `app/utils/events/**` (5 new files), `app/services/*.server.ts` (4 new files), `app/routes/$tenant/api/events.tsx` (new resource route), `app/routes/$tenant/notifications/` (new route tree), `app/routes/$tenant/settings/integrations/webhooks/` (new route tree), `app/hooks/use-sse.ts` (new), `app/components/notification-bell.tsx` + `notification-listener.tsx` (new), `server/sse.ts` (new), `server/app.ts` (boot-time + shutdown wiring), `app/routes/$tenant/_layout.tsx` (mount the listener + bell), `app/locales/{en,fr}/notifications.json` + `webhooks.json` (new copy), `app/utils/config/settings-registry.ts` (add `webhooks.max_subscriptions_per_tenant`, `webhooks.default_max_retries`, `notifications.retention_days`).

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`
**Reference (READ-ONLY):** `/Users/binalfew/Projects/facilities/` — port-from.
**Working directory:** `/Users/binalfew/Projects/templates/react-router`
**Branch:** `phase-6-events-jobs` off `main` (cut before Task 1).

---

## Hard constraints

- NEVER modify `/Users/binalfew/Projects/facilities`. `Read` only.
- Every task lands green (`typecheck`, `build`) before the next starts.
- Prisma destructive ops require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<exact user message>"` — expected for the 5-model migration in Task 1.
- Keep the job queue **in-process, single-instance**. A Redis-backed variant is a future phase (`FF_REDIS_QUEUE`, likely in server-hardening). Document the single-instance constraint in CLAUDE.md.
- Webhook event catalog is **template-scoped**. Do NOT port `asset.*` or `work_order.*` event types — they belong to facilities. Keep the shape + `validateEventTypes` + `getEventsByDomain` helpers intact.
- Job handlers are **template-scoped**. Do NOT port `warranty-expiration-check`, `sla-breach-check`, `pm-schedule-evaluation`, `wo-auto-close`, `asset-pm-auto-schedule`, `asset-condition-pm-adjustment`. Only `send-email` and `webhook-delivery` ship.
- SSE is **in-memory per-instance**. Document this clearly — horizontal scaling needs a pub/sub bus (out of scope).
- `FF_WEBHOOKS`, `FF_SSE`, `FF_NOTIFICATIONS` feature flags must exist before the UI wires them (they should already be in Phase 3's registry — confirm and add any missing).
- Commitlint: ≤100 chars, lowercase, conventional prefix, no `--no-verify`.
- The `webhook-delivery` handler does a dynamic `import()` to avoid circular deps — preserve that pattern from facilities.

---

## Decisions locked in this phase

| Decision                 | Choice                                                                                                                                                          | Rationale                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Job queue backend        | In-process, Postgres-backed via `Job` model + `FOR UPDATE SKIP LOCKED`                                                                                          | Matches facilities. Zero new infra. Redis future-phase.                                                                  |
| Job processor cadence    | 5000ms (5s) interval; process up to 10 jobs per tick                                                                                                            | Matches facilities. Good dev feel; prod tuning via settings.                                                             |
| Retry backoff            | Exponential 2^attempts × 30s + 0–30% jitter, capped at 1h                                                                                                       | Matches facilities. Balances retry speed with load.                                                                      |
| Webhook signing          | HMAC-SHA256 with subscription-specific secret; header `X-Webhook-Signature: sha256=<hex>`                                                                       | Industry standard (GitHub, Stripe).                                                                                      |
| Webhook retry policy     | Per-subscription `maxRetries` (default 5), per-subscription `retryBackoffMs` array (default `[1s, 5s, 30s, 5m, 30m]`), timeout default 10s                      | Matches facilities.                                                                                                      |
| Webhook circuit breaker  | Open after N consecutive failures (template: tied to `maxRetries`), auto-reset after `circuitBreakerResetAt`. Subscription moves to `SUSPENDED` status on open. | Protects downstream endpoints and our workers from dead URLs.                                                            |
| SSE transport            | Plain SSE via `ReadableStream` + `EventEmitter`                                                                                                                 | No extra deps; works behind standard reverse proxies with the right buffering config (document this).                    |
| SSE scope                | Per-tenant + optional per-user; global events blocked (fail-safe)                                                                                               | Matches facilities `emitSSE` filter.                                                                                     |
| SSE heartbeat            | 30s                                                                                                                                                             | Prevents proxy idle timeouts.                                                                                            |
| Idempotency key TTL      | 24 hours                                                                                                                                                        | Matches common API conventions. Sweeper is a follow-up (a `cleanup-idempotency-keys` job can be added in a later phase). |
| Idempotency scope        | `(key, tenantId)` unique                                                                                                                                        | Per-tenant isolation keeps keys from leaking across tenants.                                                             |
| Notification retention   | No auto-delete in Phase 6. Expose `notifications.retention_days` setting (default 90); sweeper job defers to later.                                             | Ship the infra; defer the housekeeping.                                                                                  |
| Feature flags            | `FF_WEBHOOKS`, `FF_SSE`, `FF_NOTIFICATIONS`                                                                                                                     | Phase 3 registry; confirm exist, add any missing. Default off for SSE/webhooks; notifications default on.                |
| Event emission call site | Services (not routes). Routes call services; services emit.                                                                                                     | Keeps routes thin; aligns with facilities.                                                                               |
| `emitDomainEvent` shape  | `(tenantId, eventType, data) => void`, fire-and-forget (returns void, swallows webhook errors).                                                                 | Matches facilities — callers don't block on webhook fanout.                                                              |
| Webhook payload schema   | `{ id: eventId, type: eventType, tenantId, createdAt, data }`                                                                                                   | Standard.                                                                                                                |

---

## File-level impact map

### New files

```
prisma/schema.prisma                                          — +5 models, +3 enums (modified, not new)
app/utils/events/job-queue.server.ts                          — handler registry + processor loop (~140 lines)
app/utils/events/job-handlers.server.ts                       — register send-email + webhook-delivery (~30 lines; trimmed from facilities' ~235)
app/utils/events/emit-domain-event.server.ts                  — SSE + webhook fanout (~20 lines)
app/utils/events/webhook-emitter.server.ts                    — FF-gated webhook dispatch (~25 lines)
app/utils/events/webhook-events.ts                            — event catalog + validation (~90 lines; trimmed to template events)
app/utils/events/idempotency.server.ts                        — withIdempotency helper (~60 lines; new surface, not in facilities)
app/services/notifications.server.ts                          — notification CRUD (~115 lines)
app/services/webhooks.server.ts                               — subscription CRUD + status + rotate-secret (~420 lines)
app/services/webhook-dispatcher.server.ts                     — find-and-enqueue deliveries (~70 lines)
app/services/webhook-delivery.server.ts                       — sign + POST + retry + circuit-breaker (~260 lines)
server/sse.ts                                                  — EventEmitter bus (~20 lines)
app/routes/$tenant/api/events.tsx                              — SSE resource route (~65 lines)
app/hooks/use-sse.ts                                           — consumer hook (~45 lines)
app/components/notification-bell.tsx                           — top-nav bell + dropdown (~130 lines estimate; port from facilities)
app/components/notification-listener.tsx                       — wraps useSSE, pushes toasts, revalidates (~40 lines)
app/routes/$tenant/notifications/index.tsx                     — list
app/routes/$tenant/notifications/$notificationId/read.tsx      — mark-as-read action
app/routes/$tenant/notifications/$notificationId/delete.tsx    — delete action
app/routes/$tenant/notifications/mark-all-read.tsx             — bulk mark
app/routes/$tenant/settings/integrations/_layout.tsx           — sidebar "Integrations" shell (if not already carved out)
app/routes/$tenant/settings/integrations/webhooks/index.tsx    — list subscriptions
app/routes/$tenant/settings/integrations/webhooks/new.tsx      — create
app/routes/$tenant/settings/integrations/webhooks/$webhookId._layout.tsx — detail (2/3 deliveries + 1/3 info)
app/routes/$tenant/settings/integrations/webhooks/$webhookId.delete.tsx — dialog delete
app/routes/$tenant/settings/integrations/webhooks/$webhookId.rotate-secret.tsx — dialog rotate
app/routes/$tenant/settings/integrations/webhooks/$webhookId_.edit.tsx  — standalone edit
app/locales/en/notifications.json                              — flesh out (currently placeholder from Phase 4)
app/locales/fr/notifications.json                              — mirror
app/locales/en/webhooks.json                                   — new namespace
app/locales/fr/webhooks.json                                   — mirror
```

### Modified files

```
prisma/schema.prisma                                          — add Job, IdempotencyKey, Notification, WebhookSubscription, WebhookDelivery models; JobStatus, WebhookStatus, DeliveryStatus enums; back-relations on Tenant/User.
prisma/seed.ts                                                — seed one sample webhook subscription per tenant (disabled by default); seed one welcome notification per seeded user.
server/app.ts                                                  — import job-handlers.server.ts (for side-effect registration), call startJobProcessor(5000) on boot, call stopJobProcessor() on graceful shutdown.
app/utils/i18n.ts                                              — register the new webhooks namespace; ensure notifications namespace already wired (from Phase 4).
app/routes/$tenant/_layout.tsx                                 — mount <NotificationListener> at tree root + render <NotificationBell> in top-nav (gated on FF_NOTIFICATIONS).
app/utils/config/settings-registry.ts                          — add webhooks.max_subscriptions_per_tenant (default 10), webhooks.default_max_retries (default 5), notifications.retention_days (default 90).
app/utils/config/feature-flag-keys.ts                          — confirm FF_WEBHOOKS, FF_SSE, FF_NOTIFICATIONS exist; add any missing.
app/utils/auth/require-auth.server.ts                          — no changes expected; notification/webhook routes use requirePermission with new webhook:* + notification:* actions.
prisma/seed.ts (permissions)                                   — add webhook:read, webhook:write, webhook:delete, notification:read, notification:delete to TENANT_ADMIN role.
docs/CLAUDE.md-equivalent (CLAUDE.md)                          — add "Events & jobs (Phase 6)" section documenting the single-instance queue, SSE in-memory caveat, idempotency pattern, domain-event conventions.
```

### Out of scope for Phase 6

- Redis-backed job queue / multi-instance processor.
- Pub/sub SSE for horizontal scaling.
- Notification digest emails / channel routing (email, Slack, etc.). Only in-app notifications ship.
- Retention sweeper jobs (notifications, idempotency keys). Schema + settings ready, job deferred.
- Webhook replay / manual redelivery UI. The delivery row is visible on the detail page but has no "retry this delivery" button.
- Webhook signing v2 / key rotation workflow beyond a simple "rotate" action. Enterprise-grade rotation (warn period, dual-key acceptance) is a future phase.
- FMS-specific webhook events and job handlers — facilities owns those.
- User-facing notification preferences UI (mute types, channel selection). Schema can be added when needed; Phase 6 keeps it flat.

---

## Pre-flight

### Task 0: Branch + baseline

- [ ] **Step 1: Confirm clean state.**
  ```bash
  cd /Users/binalfew/Projects/facilities && git status
  cd /Users/binalfew/Projects/templates/react-router && git status && git branch --show-current
  ```
- [ ] **Step 2: Cut the branch.** From the template monorepo root:
  ```bash
  cd /Users/binalfew/Projects/templates && git checkout -b phase-6-events-jobs
  ```
- [ ] **Step 3: Baseline.** `npm run typecheck && npm run build`.
- [ ] **Step 4: Confirm Phase 3 feature flags.** Grep `app/utils/config/feature-flag-keys.ts` for `FF_WEBHOOKS`, `FF_SSE`, `FF_NOTIFICATIONS`. Add any missing (this is a one-line registry bump + a seed update — see Task 8 if not already present).

---

## Group A — Schema + deps (Task 1)

### Task 1: Prisma schema — 5 models, 3 enums

**Files:**

- Modify: `prisma/schema.prisma`.
- Generated: `app/generated/prisma/client.js` via `prisma generate`.

**What to add:**

```prisma
// Enums (near the top, next to existing enums)
enum JobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum WebhookStatus {
  ACTIVE
  PAUSED
  DISABLED
  SUSPENDED
}

enum DeliveryStatus {
  PENDING
  DELIVERED
  FAILED
  RETRYING
  DEAD_LETTER
}

// Models (in a new "Events & Jobs" section)
model Job {
  id          String    @id @default(cuid())
  type        String
  payload     Json
  status      JobStatus @default(PENDING)
  attempts    Int       @default(0)
  maxAttempts Int       @default(3)
  nextRunAt   DateTime  @default(now())
  lastError   String?
  createdAt   DateTime  @default(now())
  completedAt DateTime?
  @@index([status, nextRunAt])
}

model IdempotencyKey {
  id           String   @id @default(cuid())
  key          String
  tenantId     String
  method       String
  path         String
  statusCode   Int
  responseBody String
  createdAt    DateTime @default(now())
  expiresAt    DateTime
  @@unique([key, tenantId])
  @@index([expiresAt])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  tenantId  String
  type      String
  title     String
  message   String
  data      Json?
  read      Boolean   @default(false)
  readAt    DateTime?
  createdAt DateTime  @default(now())
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([userId, read])
  @@index([userId, createdAt])
  @@index([tenantId])
  @@index([tenantId, createdAt])
}

model WebhookSubscription {
  id                    String        @id @default(cuid())
  tenantId              String
  tenant                Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  url                   String
  description           String?
  events                String[]
  secret                String
  status                WebhookStatus @default(ACTIVE)
  version               String        @default("v1")
  maxRetries            Int           @default(5)
  retryBackoffMs        Int[]         @default([1000, 5000, 30000, 300000, 1800000])
  timeoutMs             Int           @default(10000)
  consecutiveFailures   Int           @default(0)
  circuitBreakerOpen    Boolean       @default(false)
  circuitBreakerResetAt DateTime?
  headers               Json?
  metadata              Json?
  createdBy             String
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt
  deliveries WebhookDelivery[]
  @@index([tenantId, status])
}

model WebhookDelivery {
  id              String              @id @default(cuid())
  tenantId        String
  subscriptionId  String
  subscription    WebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  eventType       String
  eventId         String
  payload         Json
  status          DeliveryStatus      @default(PENDING)
  attempts        Int                 @default(0)
  maxAttempts     Int                 @default(5)
  nextRetryAt     DateTime?
  responseCode    Int?
  responseBody    String?
  responseHeaders Json?
  latencyMs       Int?
  errorMessage    String?
  errorType       String?
  deliveredAt     DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  @@index([subscriptionId, status])
  @@index([tenantId, eventType, createdAt])
  @@index([status, nextRetryAt])
  @@index([eventId])
  @@index([createdAt])
}
```

Tenant model gets back-relations: `notifications Notification[]`, `webhookSubscriptions WebhookSubscription[]`. User model gets `notifications Notification[]`.

- [ ] **Step 1: Add enums + models + back-relations.** Preserve existing schema layout (section banners).
- [ ] **Step 2: Migrate.**
  ```bash
  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="apply phase 6 schema migration for job/idempotency/notification/webhook models" npx prisma migrate dev --name phase-6-events-jobs
  ```
- [ ] **Step 3: Verify.** `npx prisma generate`; `npm run typecheck` passes (generated client rebuilt).
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add job, idempotency, notification, webhook schema models"
  ```

---

## Group B — Job queue core (Tasks 2–3)

### Task 2: Job queue + handler registry

**Files (new):**

- `app/utils/events/job-queue.server.ts` — port verbatim from facilities.

- [ ] **Step 1: Port the file.** Confirm import of `~/utils/monitoring/logger.server` resolves (Phase 0 shipped this).
- [ ] **Step 2: Typecheck + build.**
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add in-process job queue with backoff and SKIP LOCKED"
  ```

---

### Task 3: Job handlers (send-email + webhook-delivery only)

**Files (new):**

- `app/utils/events/job-handlers.server.ts` — trimmed from facilities to just the two handlers.

Exact content:

```ts
import { sendEmail } from "~/utils/email/email.server";
import { registerJobHandler } from "~/utils/events/job-queue.server";
import { logger } from "~/utils/monitoring/logger.server";
import type { SendEmailOptions } from "~/utils/email/email.server";

registerJobHandler("send-email", async (payload) => {
  const options = payload as SendEmailOptions;
  await sendEmail(options);
});

registerJobHandler("webhook-delivery", async (payload) => {
  const { deliveryId } = payload as { deliveryId: string };
  const { deliverWebhook } = await import("~/services/webhook-delivery.server");
  await deliverWebhook(deliveryId);
});

logger.debug("Job handlers registered");
```

The dynamic `import()` for `deliverWebhook` is deliberate — it lets us register the handler before `webhook-delivery.server.ts` exists (prevents circular imports and defers loading).

- [ ] **Step 1: Write the file.** `webhook-delivery.server.ts` doesn't exist yet; the dynamic import means typecheck will still pass because `await import(...)` is typed to `any` at resolution time unless specifically typed. Confirm this doesn't trigger a TS error — if it does, comment out the webhook-delivery handler and restore it in Task 8.
- [ ] **Step 2: Typecheck.**
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): register send-email and webhook-delivery job handlers"
  ```

---

## Group C — SSE + domain events (Tasks 4–5)

### Task 4: Server-side SSE bus + resource route

**Files (new):**

- `server/sse.ts` — `EventEmitter` + `emitSSE` + `SSEEvent` type. Port verbatim.
- `app/routes/$tenant/api/events.tsx` — SSE stream endpoint. Port verbatim.
- `app/hooks/use-sse.ts` — consumer hook. Port verbatim.

Confirm `server/sse.ts` is included in `tsconfig.vite.json`'s `include` array (Phase 0 set this up for `server/`). The `../../../server/sse` relative import from `events.tsx` must resolve — facilities uses that exact relative path; template should work identically.

- [ ] **Step 1: Port the three files.**
- [ ] **Step 2: Dev-run smoke test.** `npm run dev`, open `/admin/api/events` in a browser (or `/<tenant-slug>/api/events` after login) — should hold the connection open and emit heartbeats every 30s.
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add SSE bus, events resource route, useSSE hook"
  ```

---

### Task 5: Domain event emitter

**Files (new):**

- `app/utils/events/emit-domain-event.server.ts` — `(tenantId, eventType, data) => void` fire-and-forget. Port verbatim.
- `app/utils/events/webhook-emitter.server.ts` — FF-gated webhook dispatch wrapper. Port verbatim. Confirm `FEATURE_FLAG_KEYS.WEBHOOKS` resolves (Phase 3 should have shipped this; if not, add to `feature-flag-keys.ts` + seed `FF_WEBHOOKS=false`).

Note: `webhook-emitter` imports from `~/services/webhook-dispatcher.server` which doesn't exist yet. Either use a dynamic import or defer populating the file body until Task 7. Minimal approach: write the file stub that imports statically; typecheck will fail; then implement dispatcher in Task 7 to close the loop. Alternative: write both files in the same commit to land green in one step.

**Recommendation:** fold Task 5 + Task 7 into a single commit boundary to avoid a broken intermediate. Land Task 5 content alongside Task 7's `webhook-dispatcher.server.ts` stub.

- [ ] **Step 1: Write `emit-domain-event.server.ts`.** It imports `emitSSE` (exists from Task 4) and `emitWebhookEvent` (stub in Task 5 same commit).
- [ ] **Step 2: Write `webhook-emitter.server.ts` with a stubbed dispatcher call** (`async function dispatchWebhookEvent() {}` locally, OR land real dispatcher next). Prefer real dispatcher: skip ahead.
- [ ] **Step 3 (preferred): Write the dispatcher stub inline** — exports `dispatchWebhookEvent(tenantId, eventType, eventId, data)` that logs and no-ops. Task 7 replaces it with the real implementation.
- [ ] **Step 4: Typecheck.**
- [ ] **Step 5: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add domain event emitter and webhook emitter scaffold"
  ```

---

## Group D — Webhook services + admin UI (Tasks 6–10)

### Task 6: Webhook event catalog

**Files (new):**

- `app/utils/events/webhook-events.ts` — template-scoped event names.

**Scope:** Port facilities' structure (type union, `WEBHOOK_EVENTS` map, `validateEventTypes`, `getEventsByDomain`) but trim to template events only. Exact event set:

```
user.created, user.updated, user.deleted
role.created, role.updated, role.deleted
tenant.updated
settings.changed
api_key.created, api_key.revoked, api_key.rotated
invitation.created, invitation.accepted, invitation.revoked
```

Drop all `asset.*` and `work_order.*`. If Phase 1/2/3 emit webhook events from their services, the event names must exist here — audit and align.

- [ ] **Step 1: Port with the trimmed catalog.**
- [ ] **Step 2: Audit Phase 1–3 service emissions.** Grep for `emitDomainEvent` / `emitWebhookEvent` in `app/services/` — every event name must be in this catalog. (If no services emit yet, that's fine; they'll be added in Task 11.)
- [ ] **Step 3: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add webhook event catalog (template-scoped)"
  ```

---

### Task 7: Webhook services — dispatcher + delivery + subscription CRUD

**Files (new):**

- `app/services/webhook-dispatcher.server.ts` — `dispatchWebhookEvent(tenantId, eventType, eventId, data)`: finds matching subscriptions (including `*`), creates `WebhookDelivery` rows in a transaction, enqueues one `webhook-delivery` job per delivery.
- `app/services/webhook-delivery.server.ts` — `deliverWebhook(deliveryId)`: loads the delivery, signs payload with HMAC-SHA256 using subscription secret, POSTs with timeout, interprets response (2xx = DELIVERED, other = retry or DEAD_LETTER), updates circuit-breaker state on the subscription.
- `app/services/webhooks.server.ts` — subscription CRUD + status transitions + secret rotation. Port verbatim; confirm imports resolve.

This closes the Task 5 loop — real dispatcher replaces the stub.

- [ ] **Step 1: Port all three files from facilities.** Adjust imports (`~/utils/auth/audit.server`, `~/utils/monitoring/logger.server`) to template paths.
- [ ] **Step 2: Typecheck + build.**
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add webhook dispatcher, delivery, and subscription services"
  ```

---

### Task 8: Feature flags + settings

**Files (modify):**

- `app/utils/config/feature-flag-keys.ts` — ensure `FF_WEBHOOKS`, `FF_SSE`, `FF_NOTIFICATIONS` exist.
- `prisma/seed.ts` — seed flags if missing (default: WEBHOOKS=false, SSE=true, NOTIFICATIONS=true).
- `app/utils/config/settings-registry.ts` — add `webhooks.max_subscriptions_per_tenant` (int, default 10), `webhooks.default_max_retries` (int, default 5), `notifications.retention_days` (int, default 90).

- [ ] **Step 1: Audit existing flags.** Only add what's missing.
- [ ] **Step 2: Seed + settings.**
- [ ] **Step 3: `npm run db:seed` succeeds.** Typecheck.
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): seed webhook and notification feature flags and settings"
  ```

---

### Task 9: Notification service

**Files (new):**

- `app/services/notifications.server.ts` — port verbatim.

- [ ] **Step 1: Port.** Confirm `emitSSE` import path (`../../server/sse` or `~/` — match Phase 4's resolution).
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add notifications service"
  ```

---

### Task 10: Idempotency helper

**Files (new):**

- `app/utils/events/idempotency.server.ts` — new surface, not in facilities as a dedicated util.

**Behaviour:**

```ts
export async function withIdempotency<T>(
  request: Request,
  tenantId: string,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return handler();
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key_tenantId: { key, tenantId } },
  });
  if (existing && existing.expiresAt > new Date()) {
    return { status: existing.statusCode, body: JSON.parse(existing.responseBody) };
  }
  const result = await handler();
  await prisma.idempotencyKey.upsert({
    where: { key_tenantId: { key, tenantId } },
    create: {
      key,
      tenantId,
      method: request.method,
      path: new URL(request.url).pathname,
      statusCode: result.status,
      responseBody: JSON.stringify(result.body),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    update: {
      statusCode: result.status,
      responseBody: JSON.stringify(result.body),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return result;
}
```

- [ ] **Step 1: Write the helper.** Document usage in a JSDoc block.
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add idempotency helper for write api endpoints"
  ```

---

## Group E — UI (Tasks 11–14)

### Task 11: Wire domain-event emissions from existing services

**Files (modify):**

- `app/services/users.server.ts` — emit `user.created` / `user.updated` / `user.deleted` on create / update / delete.
- `app/services/roles.server.ts` — emit `role.*`.
- `app/services/tenants.server.ts` — emit `tenant.updated`.
- `app/services/settings.server.ts` — emit `settings.changed` on write.
- `app/services/api-keys.server.ts` — emit `api_key.created` / `api_key.revoked` / `api_key.rotated`.
- `app/services/invitations.server.ts` — emit `invitation.*`.

Use `emitDomainEvent(tenantId, "user.created", { id, email, ... })` after each write. Keep the data payload small — IDs, key fields, no full entity dumps.

- [ ] **Step 1: Audit each service for write sites.**
- [ ] **Step 2: Thread emissions.** One commit per service is fine; or bundle if diffs are small.
- [ ] **Step 3: Smoke.** `npm run dev`, seed a tenant, create a user, verify logs show the emit (or observe via a curl against `/api/events`).
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): emit domain events from user, role, tenant, settings, api-key, invitation services"
  ```

---

### Task 12: Notification bell + listener + i18n

**Files (new):**

- `app/components/notification-bell.tsx` — top-nav icon + unread badge + dropdown list (shadcn `DropdownMenu`). Fetches `getUnreadCount` + recent notifications in the tenant layout loader; uses `useFetcher` for mark-read actions.
- `app/components/notification-listener.tsx` — wraps `useSSE(tenantSlug, { onNotification: (n) => toast.info(n.title), onDataChange: revalidate })`. Mount once in `$tenant/_layout.tsx`.

**Files (modify):**

- `app/routes/$tenant/_layout.tsx` — add loader fields for unread count + recent (5) notifications (FF_NOTIFICATIONS gate). Render bell + listener in the top-nav area. Defensive: if flag off, skip both.
- `app/locales/en/notifications.json` — flesh out (title, empty, markAllRead, markRead, delete, justNow, minutesAgo, hoursAgo, etc.).
- `app/locales/fr/notifications.json` — mirror.

- [ ] **Step 1: Port bell + listener components** from facilities (adjust imports for shadcn DropdownMenu path + toast system).
- [ ] **Step 2: Wire tenant layout loader + render.**
- [ ] **Step 3: Fill translations.**
- [ ] **Step 4: Smoke.** `npm run dev`, create a notification via node repl / action, verify bell updates in real-time.
- [ ] **Step 5: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add notification bell, sse listener, and tenant layout wiring"
  ```

---

### Task 13: Notifications routes (list, mark-read, delete)

**Files (new):**

- `app/routes/$tenant/notifications/index.tsx` — DataTable-backed list with filter (read/unread/type), mark-as-read + delete row actions.
- `app/routes/$tenant/notifications/$notificationId/read.tsx` — POST action: `markAsRead`, redirect back.
- `app/routes/$tenant/notifications/$notificationId/delete.tsx` — POST action: `deleteNotification`, redirect back.
- `app/routes/$tenant/notifications/mark-all-read.tsx` — POST action: `markAllAsRead`, redirect back.

Use Phase 5's `DataTable` + `ColumnDef`. Gate on `FF_NOTIFICATIONS` via `requireFeature`.

- [ ] **Step 1: Build the four routes.**
- [ ] **Step 2: Smoke.** List loads, row actions work, redirect preserves filters.
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add notifications list and row actions"
  ```

---

### Task 14: Webhook admin UI

**Files (new):**

- `app/routes/$tenant/settings/integrations/_layout.tsx` — sidebar/nav shell for integrations if not already present.
- `app/routes/$tenant/settings/integrations/webhooks/index.tsx` — DataTable of subscriptions.
- `app/routes/$tenant/settings/integrations/webhooks/new.tsx` — create form (url, description, events multi-select, optional custom headers).
- `app/routes/$tenant/settings/integrations/webhooks/+shared/webhook-editor.tsx` + `.server.tsx` — shared editor pattern from Phase 5.
- `app/routes/$tenant/settings/integrations/webhooks/$webhookId._layout.tsx` — detail page (2/3: recent deliveries list + 1/3: subscription info + status badge).
- `app/routes/$tenant/settings/integrations/webhooks/$webhookId.delete.tsx` — dialog.
- `app/routes/$tenant/settings/integrations/webhooks/$webhookId.rotate-secret.tsx` — dialog confirming + showing new secret once.
- `app/routes/$tenant/settings/integrations/webhooks/$webhookId_.edit.tsx` — standalone edit (escape layout).
- `app/locales/en/webhooks.json` + `fr/webhooks.json` — new namespace; register in `app/utils/i18n.ts`.

- [ ] **Step 1: Build subscription CRUD using the shared-editor pattern.**
- [ ] **Step 2: Build detail page with deliveries list.**
- [ ] **Step 3: Rotate-secret dialog** surfaces the new secret once (session-scoped); user must copy or it's lost.
- [ ] **Step 4: Register i18n namespace.**
- [ ] **Step 5: Smoke.** Create a subscription with a test URL (e.g., `https://webhook.site`), trigger a `user.created` event, confirm delivery lands with 2xx.
- [ ] **Step 6: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add webhook subscription admin ui with shared editor"
  ```

---

## Group F — Boot wiring + docs (Tasks 15–16)

### Task 15: Boot + graceful shutdown

**Files (modify):**

- `server/app.ts` — after HTTP server mounts, call `startJobProcessor(5000)`; in the graceful-shutdown handler, call `stopJobProcessor()`. Import `app/utils/events/job-handlers.server.ts` once at top (side-effect registration).

- [ ] **Step 1: Wire `startJobProcessor` + `stopJobProcessor`.**
- [ ] **Step 2: Smoke.** `npm run dev`, confirm `"Starting job processor"` log line appears on boot. `npm run db:seed`, enqueue a `send-email` job manually, verify it processes within 5s.
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): start job processor on boot and stop on shutdown"
  ```

---

### Task 16: CLAUDE.md — "Events & Jobs" section

**Files (modify):**

- `CLAUDE.md` — append a section documenting:
  - Single-instance job queue constraint (no horizontal scaling yet).
  - SSE is in-memory per-instance (same constraint).
  - Domain-event emission convention: services emit, routes never emit directly.
  - Idempotency helper usage for write API endpoints.
  - Webhook event catalog is template-scoped; apps add their own.
  - Feature-flag gates: `FF_WEBHOOKS`, `FF_SSE`, `FF_NOTIFICATIONS`.
  - Fail-safe rule: `emitDomainEvent` is fire-and-forget; consumer errors never break the caller.

- [ ] **Step 1: Write the section.**
- [ ] **Step 2: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "docs(template): document events and jobs conventions in claude.md"
  ```

---

## Group G — Validation + merge decision (Task 17)

### Task 17: Final validation

- [ ] **Facilities clean.** `cd /Users/binalfew/Projects/facilities && git status` → clean.
- [ ] **Typecheck.** `npm run typecheck` → pass.
- [ ] **Build.** `npm run build` → pass.
- [ ] **DB.** `npx prisma migrate status` → clean. `npm run db:seed` → succeeds.
- [ ] **Dev smoke (quick).**
  1. Log in, bell shows (FF_NOTIFICATIONS on).
  2. Create a user via admin UI → toast fires (SSE), bell badge increments.
  3. `/notifications` list shows the notification; mark-read flips state.
  4. Create a webhook subscription pointing at webhook.site; create another user → delivery lands with 2xx.
  5. Stop the receiving webhook, trigger event → delivery retries per backoff, eventually DEAD_LETTER after maxRetries; circuit breaker opens.
  6. Enqueue a `send-email` job (dev action or node repl) → processed within 5s.
- [ ] **Commit count.** `git log --oneline main..phase-6-events-jobs` — expect 15–18 commits.
- [ ] **Summary + pause for merge decision.**

---

## Rollback plan

- Per-task: `git reset --soft HEAD~1` to unstage + fix.
- Phase: `git checkout main && git branch -D phase-6-events-jobs` then recreate from `main`.
- Schema rollback: `npx prisma migrate resolve --rolled-back phase-6-events-jobs` then delete the migration folder. Needs `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`.
- If tenant layout loader breaks under flag-off conditions (FF_NOTIFICATIONS): guard the unread-count fetch with `isFeatureEnabled` before reading — easy fix.

---

## Open questions deferred to per-task decisions

- **Job processor in dev mode with Vite HMR:** each HMR reload may re-register handlers + double-start the processor. Facilities handles this via the `intervalId` guard in `startJobProcessor` (idempotent). Confirm the guard holds under Vite HMR; if not, add a process-level flag.
- **SSE through Vite dev proxy:** Express middleware-mode Vite sometimes buffers. If `/api/events` hangs without flushing, adjust Vite's `proxy.ws = false` or disable buffering for that route.
- **Webhook secret display:** show the secret once on creation + once on rotation. After that, it's hashed-or-hidden. Decision: store plaintext in DB (facilities does) — OK for Phase 6; HSM/secret-vault is a later hardening phase.
- **Permission model:** `webhook:read`, `webhook:write`, `webhook:delete`, `notification:read`, `notification:delete`. Seed for TENANT_ADMIN role. Confirm Phase 3's permission seed has an `upsert` pattern we can extend.
- **Re-enqueue patterns for recurring jobs:** facilities uses the "handler re-enqueues itself" pattern for `sla-breach-check` etc. Template has no recurring jobs yet, so this pattern doesn't land in Phase 6 — document it in CLAUDE.md for future reference.

---

## Phase 6 open deviations (fill in during execution)

- [ ] Any job-handler-type import that breaks the `app/utils/events/job-handlers.server.ts` registration order — note + resolution.
- [ ] Any webhook event name that Phase 1/2/3 services emit but this catalog doesn't include — note the name, decide add-to-catalog vs. drop-emit.
- [ ] Any SSE reconnection issue in dev — note + fix.
- [ ] Whether the idempotency helper needs a `@@unique` composite name tweak (`key_tenantId` vs `tenantId_key`) — verify after `prisma generate`.
