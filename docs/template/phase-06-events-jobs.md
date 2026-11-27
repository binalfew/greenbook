# Domain events & notifications (Phase 6)

What is in the code today: a domain-event emitter that writes to the structured log, and in-app notifications stored per user.

> **Not shipped.** The original phase also planned a Postgres-backed job queue, outbound webhooks, idempotency keys, and real-time updates over server-sent events (an SSE endpoint, a `use-sse` hook, a notification listener, the `FF_SSE` flag). None of that is in the code. Nothing runs in the background and nothing is pushed to the browser. The file keeps its old name so existing links still resolve.

## Domain events

`~/utils/events/emit-domain-event.server.ts` — `emitDomainEvent(tenantId, eventType, data)` records the event with `logger.debug` and returns. It is synchronous, never throws, and never blocks the caller's write. There is no subscriber registry and no delivery: a service that wants something to happen when an event occurs (send a notification, write an audit row) calls that code itself, next to the emit.

`~/utils/events/domain-events.ts` — `DOMAIN_EVENTS`, the catalog of event type names with a one-line description each, and the `DomainEventType` union. The catalog is a list of names, not a guarantee: some types in it (`user.updated`, `user.deleted`, `role.*`) have no emitter yet.

Events emitted today:

- `tenant.created` / `tenant.updated` / `tenant.deleted` — `~/services/tenants.server.ts`
- `user.created` — through `emitUserCreated(user, tenantId, extra?)` in `~/utils/events/emit-user-created.server.ts`, which fixes the payload shape
- `settings.changed` — `~/utils/config/settings.server.ts`
- `change.submitted` / `change.approved` / `change.rejected` / `change.withdrawn`, and the entity events (`organization.created`, `person.updated`, `position.assigned`, …) that fire when a change is approved — `~/services/directory-changes.server.ts`

To add an event: add its name to `DOMAIN_EVENTS`, then call `emitDomainEvent` after the write has committed.

## Notifications

`~/services/notifications.server.ts`:

- `createNotification(input)` — stores one `Notification` row for one user.
- `getUnreadCount(userId)`, `listNotifications(userId, { page?, perPage?, type?, ... })`
- `markAsRead(id, userId)`, `markAllAsRead(userId)`, `deleteNotification(id, userId)`
- `openNotification(id, userId)` — marks the notification read and returns it, so the caller can redirect to what it points at.

Every function is scoped by `userId`; a user only ever reads or changes their own notifications.

UI:

- `~/components/notification-bell.tsx` — the bell in the tenant layout, with the unread count and the five most recent notifications. `app/routes/$tenant/_layout.tsx` loads that data when `FF_NOTIFICATIONS` is on for the tenant, so the bell is current as of the last page load or revalidation.
- `$tenant/notifications/index.tsx` — the full list.
- `$tenant/notifications/mark-all-read.tsx`, `$notificationId.read.tsx`, `$notificationId.open.tsx`, `$notificationId.delete.tsx` — actions.

The routes call `requireTenantFeature(request, "FF_NOTIFICATIONS")` from `~/utils/acting-tenant.server`, which evaluates the flag for the tenant in the URL. There are no notification permissions: access follows ownership.

The directory workflow is the one producer: `~/services/directory-notifications.server.ts` notifies approvers when drafts are submitted and the submitter when a change is approved or rejected. Failures there are logged and never undo the change.

## Deviations

- **No background work.** Email is sent inline from the request that triggers it (`~/utils/email/email.server.ts`).
- **No bell on the directory search pages.** `/` and `/people/*` use the public layout, which has no notification UI.
