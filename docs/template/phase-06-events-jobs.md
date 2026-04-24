# Events & Jobs (Phase 6)

The template ships a background-jobs, SSE, webhook, and notification stack. Entry points:

## Job queue

**In-process, single-instance, Postgres-backed.** `app/utils/events/job-queue.server.ts` exports `enqueueJob(type, payload, opts?)`, `registerJobHandler(type, handler)`, `startJobProcessor()`, and `stopJobProcessor()`. The processor is started on boot from `server/app.ts` on a 5-second interval and claims jobs atomically via `FOR UPDATE SKIP LOCKED`. Failed jobs retry with exponential backoff (2^attempts × 30s + jitter, cap 1h).

**Horizontal scaling is not supported in Phase 6** — running multiple Node processes will still only have one processor per process, but they all hit the same DB and claim jobs competitively, which works. SSE, however, is in-memory per-instance; a pub/sub bus is needed for multi-instance SSE fan-out (deferred to a later phase).

To add a new job type:

```ts
// app/utils/events/job-handlers.server.ts
registerJobHandler("my-job", async (payload) => {
  const { id } = payload as { id: string };
  // …do work
});
```

Enqueue from a service or route:

```ts
await enqueueJob("my-job", { id: "abc" }, { maxAttempts: 5, delay: 60_000 });
```

## Domain events

Services emit domain events through `emitDomainEvent(tenantId, eventType, data)` from `app/utils/events/emit-domain-event.server.ts`. This is **fire-and-forget** — it calls `emitSSE` (real-time UI) and `emitWebhookEvent` (external consumers) and suppresses errors so the caller's write path never blocks on a slow webhook.

**Rule: services emit, routes never emit directly.** Keep the routes thin.

```ts
// In a service after a successful write:
await prisma.user.create({ data: { ... } });
emitDomainEvent(tenantId, "user.created", { id: user.id, email: user.email });
```

## Webhook subscriptions

`app/services/webhooks.server.ts` — subscription CRUD + pause/resume + rotate-secret + test-endpoint. `webhook-dispatcher.server.ts` fans an event out to matching subscriptions and fires `deliverWebhook` asynchronously. `webhook-delivery.server.ts` signs the payload with HMAC-SHA256, POSTs with timeout, retries with per-subscription backoff, and opens a circuit breaker after `CIRCUIT_BREAKER_THRESHOLD` consecutive failures. Event names the template emits live in `app/utils/events/webhook-events.ts` — apps extend this catalog with their own.

Feature flag: `FF_WEBHOOKS` (default **off**). The emitter short-circuits when disabled.

## SSE

`server/sse.ts` exposes `emitSSE({ type, tenantId, userId?, data })`; `app/routes/$tenant/api/events.tsx` is the stream endpoint; `app/hooks/use-sse.ts` is the consumer hook. Events are scoped per-tenant, optionally per-user; cross-tenant leakage is blocked. 30-second heartbeats prevent proxy idle timeouts.

Feature flag: `FF_SSE` (default **on**).

## Notifications

`app/services/notifications.server.ts` — `createNotification`, `getUnreadCount`, `listNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`. Creating a notification emits an SSE `notification` event so the UI updates in real-time.

Feature flag: `FF_NOTIFICATIONS` (default **on**).

## Idempotency

Write API endpoints that accept `Idempotency-Key` headers wrap their handler in `withIdempotency(request, tenantId, handler)` from `app/utils/events/idempotency.server.ts`. 24-hour TTL, `(key, tenantId)` unique. A cache sweeper job is deferred to a later phase.

## Phase 6b additions

Phase 6b activated the Phase 6a infrastructure:

- **Emission wiring.** `emitDomainEvent` now fires from `tenants.server.ts` (tenant.created / updated / deleted), `api-keys.server.ts` (api_key.created / revoked / rotated), `invitations.server.ts` (invitation.created / accepted / revoked), and `settings.server.ts` (settings.changed, tenant-scope only). A shared `emit-user-created.server.ts` helper fires `user.created` from `signup()` and the invitation-accept route.
- **Notification bell + listener** mounted in the tenant top-nav (`~/components/notification-bell`, `~/components/notification-listener`). Bell reads `unreadCount` + 5 recent notifications from the layout loader; listener wraps `useSSE` and surfaces notifications as `toast.info`. Both gated: bell on `FF_NOTIFICATIONS`, listener on `FF_SSE`.
- **Notifications routes** at `$tenant/notifications/` — DataTable list with status filter, row actions for mark-as-read + delete, toolbar action for mark-all-read. All gated on `FF_NOTIFICATIONS` via `requireFeature`.
- **Webhook admin** at `$tenant/settings/webhooks/` — list, new, detail (2/3 deliveries + 1/3 info with test-ping button), edit (standalone escape route), delete + rotate-secret dialogs. Uses the Phase 5 shared-editor pattern (`+shared/webhook-editor.tsx` + `.server.tsx`). Rotate reveals the new secret exactly once; creation reveals via `?secretRevealed=1` query flag.
- **Settings sidebar** gained a "Webhooks" entry that conditionally renders based on the per-tenant `FF_WEBHOOKS` flag (evaluated in the settings `_layout.tsx` loader).
- **i18n:** `notifications.json` fleshed out (20 keys); new `webhooks.json` namespace (40 keys) registered in `~/utils/i18n.ts`.
- **Permissions:** `notification:{read,write,delete}` + `webhook:{read,write,delete}` added to the seed UNIQUE_PERMISSIONS list (admin role gets them automatically via the seed's "all permissions" assignment).
- **Webhook event catalog** grew: `tenant.created`, `tenant.deleted` added alongside the existing `tenant.updated`.

## Deviations

- No `logger.server.ts` existed when Phase 6 landed — ports used `console.*` (info/warn/error). Phase 13 (server hardening) landed a real pino logger and swept those call sites.
