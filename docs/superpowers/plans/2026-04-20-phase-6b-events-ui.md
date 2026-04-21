# Phase 6b — Events Wiring + Notification UI + Webhook Admin Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Activate the Phase 6a infrastructure by (1) emitting domain events from the template's own services, (2) rendering a notification bell + in-app notification list, and (3) shipping a webhook subscription admin UI under settings. By the end: creating a user or invitation emits both SSE (toast appears in open tabs) and a webhook (if a subscription is configured); users see a notification bell with unread badge; settings has a new "Webhooks" section with full CRUD + rotate-secret + test-ping.

**Architecture added:**

- **Emission wiring** — `emitDomainEvent` calls added at write sites in `tenants.server.ts`, `api-keys.server.ts`, `invitations.server.ts`, plus a new helper for user creation used from signup + invitation-accept + tenant-setup. Also settings writes in `settings.server.ts`. A small `notify-on-admin-action.ts` helper creates in-app notifications for specific domain events (e.g., when an admin is invited, notify the sender).
- **i18n namespaces:** flesh out `notifications.json` (placeholder → 10+ keys), add `webhooks.json`, register both in `app/utils/i18n.ts`.
- **Notification listener + bell:** `app/components/notification-listener.tsx` mounts `useSSE` and fires `toast.info` + revalidates loaders. `app/components/notification-bell.tsx` reads unread count + recent 5 from tenant layout loader, renders a dropdown with mark-all-read + link to `/notifications`.
- **Notification routes:** `$tenant/notifications/index.tsx` (list + filters), dialog actions for mark-as-read / delete / mark-all-read.
- **Webhook admin:** `$tenant/settings/webhooks/` with list/new/detail/edit/delete/rotate-secret using the Phase 5 shared-editor pattern (`+shared/webhook-editor.tsx` + `.server.tsx`).
- **Permissions:** seed `notification:read`, `notification:write`, `notification:delete`, `webhook:read`, `webhook:write`, `webhook:delete` to the default TENANT_ADMIN role.

**Tech stack touched:** `app/services/{tenants,api-keys,invitations,settings}.server.ts` (emission wiring), `app/services/notifications.server.ts` (add a `notifyAdmins` or similar helper if needed), `app/services/webhooks.server.ts` (already exists, no change), `app/routes/_auth/signup.tsx` (emit user.created), `app/routes/_auth/accept-invite.tsx` (emit user.created + invitation.accepted), `app/services/tenant-setup.server.ts` (emit user.created + tenant.updated during bootstrap), `app/utils/i18n.ts` (register `webhooks` namespace), `app/locales/{en,fr}/notifications.json` + `webhooks.json`, `app/routes/$tenant/_layout.tsx` (mount listener + bell), `app/routes/$tenant/notifications/**` (new route tree), `app/routes/$tenant/settings/webhooks/**` (new route tree), `app/routes/$tenant/settings/_layout.tsx` (add "Webhooks" NAV item), `prisma/seed.ts` (permissions + default TENANT_ADMIN assignments), `CLAUDE.md` (update the "Phase 6 deviations" block — most items should close).

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`
**Reference (READ-ONLY):** `/Users/binalfew/Projects/facilities/`
**Working directory:** `/Users/binalfew/Projects/templates/react-router`
**Branch:** `phase-6b-events-ui` off `main`.

---

## Hard constraints

- NEVER modify `/Users/binalfew/Projects/facilities`. `Read` only.
- Every task lands green (`typecheck`, `build`).
- No new Prisma models this phase — infrastructure already in place.
- Commitlint: ≤100 chars, lowercase, conventional prefix, no `--no-verify`.
- Use `~/components/form` (Phase 5 Conform wrapper) for all new forms; dropdowns via `SelectField` or shadcn `Select`.
- Use `~/components/data-table/data-table` (Phase 5) for notification + webhook lists.
- Use the Phase 5 shared-editor pattern (`+shared/` folder) for webhook create/edit.
- Keep emission payloads small (IDs + key fields, no full entity dumps).
- Never emit from route actions — emission happens inside services (or tightly adjacent auth helpers).
- All routes must be feature-flag gated: notifications require `FF_NOTIFICATIONS`, webhooks require `FF_WEBHOOKS`.

---

## Decisions locked in this phase

| Decision                          | Choice                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| User creation emission point      | A single `emitUserCreated(user, tenantId)` helper called from signup, accept-invite, and tenant-setup                                      |
| Listener/toast library            | Reuse existing sonner `toast` (template already ships it via Phase 0)                                                                      |
| Bell render location              | Top-nav (right side, before `LanguageSwitcher`); DropdownMenu with unread count badge                                                      |
| Webhook admin location            | `$tenant/settings/webhooks/` — settings sidebar gains a "Webhooks" entry gated on `FF_WEBHOOKS`; no separate `integrations/` shell for now |
| Shared editor pattern             | `$tenant/settings/webhooks/+shared/webhook-editor.tsx` + `.server.tsx` per CLAUDE.md                                                       |
| Delete + rotate-secret as dialogs | Both are dialog overlays over the detail page (dot-delimited filenames inside the `$webhookId` layout)                                     |
| Rotate-secret UX                  | Show the new secret exactly once after confirmation — user must copy; fallback is another rotation                                         |
| Test-ping from detail page        | Shipped as a fetcher-based button (no dedicated route); service has `testWebhookEndpoint` already                                          |
| Permission seeding                | Upsert into TENANT_ADMIN — same pattern as Phase 3 extensions                                                                              |
| `emitDomainEvent` call sites      | **Services only.** Routes never emit. Auth helpers (signup, accept-invite) emit via a service-layer helper, not inline                     |

---

## Task list

### Group A — Prep (Tasks 1–3)

1. **Seed permissions + i18n namespace registration**
   - Add 6 permissions + assign to TENANT_ADMIN in `prisma/seed.ts`.
   - Register `webhooks` namespace in `app/utils/i18n.ts` (import en/fr json, add to `resources` and `NAMESPACES`).
   - Flesh out `notifications.json` keys (empty, markAsRead, markAllRead, delete, justNow, minutesAgo, hoursAgo, daysAgo, etc.).
   - Create `webhooks.json` en/fr with list/detail/edit/delete/rotate copy.
   - Commit: `feat(template): seed webhook and notification permissions and translations`

2. **Emission wiring in services**
   - `tenants.server.ts`: emit `tenant.updated` on update, `tenant.deleted` (add to catalog) on softDelete.
   - `api-keys.server.ts`: emit `api_key.created`, `api_key.rotated`, `api_key.revoked`.
   - `invitations.server.ts`: emit `invitation.created`, `invitation.accepted`, `invitation.revoked`.
   - `settings.server.ts`: emit `settings.changed` on set.
   - Commit: `feat(template): emit domain events from tenant, api-key, invitation, settings services`

3. **User creation emission helper + wiring**
   - Create `app/utils/events/emit-user-created.server.ts` — `emitUserCreated(user: {id, email, tenantId}, tenantId)` wrapper.
   - Call from: `signup.tsx` action (after user.create), `accept-invite.tsx` action, `tenant-setup.server.ts` bootstrap-admin path. Invitation-accept also emits `invitation.accepted`.
   - Commit: `feat(template): emit user.created from signup, invitation accept, tenant setup`

### Group B — Notification UI (Tasks 4–6)

4. **Notification listener component**
   - `app/components/notification-listener.tsx` — wraps `useSSE`, fires `toast.info` on notifications, calls `revalidator.revalidate()` on `data_change` events. Reads tenant slug + user ID as props.
   - Commit: `feat(template): add notification sse listener component`

5. **Notification bell component**
   - `app/components/notification-bell.tsx` — shadcn DropdownMenu trigger with unread count badge. Body shows recent 5 notifications (title + ago) + "Mark all read" + "View all" link.
   - Commit: `feat(template): add notification bell with unread badge and dropdown`

6. **Wire bell + listener into tenant layout**
   - `$tenant/_layout.tsx`: extend loader to return `unreadCount` + `recentNotifications` + `ffNotifications` gate. Add props to the component, conditionally render `<NotificationBell>` + `<NotificationListener>`.
   - Commit: `feat(template): mount notification bell and listener in tenant layout`

### Group C — Notification routes (Task 7)

7. **Notifications list + row actions**
   - `$tenant/notifications/index.tsx` — DataTable of notifications with filters (read/unread/type), row actions for mark-read + delete, toolbar action "Mark all read".
   - `$tenant/notifications/$notificationId/read.tsx` — POST action, marks as read, redirects back.
   - `$tenant/notifications/$notificationId/delete.tsx` — POST action, deletes, redirects back.
   - `$tenant/notifications/mark-all-read.tsx` — POST action.
   - All gated on `requireFeature(request, "FF_NOTIFICATIONS")`.
   - Commit: `feat(template): add notifications list with row actions and mark-all-read`

### Group D — Webhook admin (Tasks 8–11)

8. **Add Webhooks to settings sidebar**
   - `$tenant/settings/_layout.tsx` — extend NAV with `{ to: "webhooks", label: t("navWebhooks") }` gated on FF_WEBHOOKS (loader evaluates the flag, passes to component).
   - Commit: `feat(template): add webhooks entry to settings sidebar`

9. **Webhook list + shared editor + new**
   - `$tenant/settings/webhooks/index.tsx` — DataTable of subscriptions.
   - `$tenant/settings/webhooks/+shared/webhook-editor.tsx` — Conform form with url / description / events multi-select / optional custom headers (JSON textarea).
   - `$tenant/settings/webhooks/+shared/webhook-editor.server.tsx` — shared action upserts via `createWebhookSubscription` or `updateWebhookSubscription`.
   - `$tenant/settings/webhooks/new.tsx` — thin wrapper. After create, show the secret once on the detail page via a query param (`?secretRevealed=1`).
   - Commit: `feat(template): add webhook subscription list and shared editor`

10. **Webhook detail + standalone edit**
    - `$tenant/settings/webhooks/$webhookId._layout.tsx` — 2/3 layout: left column = recent deliveries DataTable, right = subscription info (url, events, status, secret-masked). Includes "Test ping" fetcher button.
    - `$tenant/settings/webhooks/$webhookId_.edit.tsx` — standalone edit wrapper (shared editor).
    - Commit: `feat(template): add webhook detail page with deliveries and test ping`

11. **Delete + rotate-secret dialogs**
    - `$tenant/settings/webhooks/$webhookId.delete.tsx` — dialog, calls `deleteWebhookSubscription`.
    - `$tenant/settings/webhooks/$webhookId.rotate-secret.tsx` — dialog showing new secret once after submit.
    - Commit: `feat(template): add webhook delete and rotate-secret dialogs`

### Group E — Docs + validation (Tasks 12–13)

12. **CLAUDE.md updates**
    - Remove the three "Phase 6 deviations" bullet points from the Events & Jobs section — they're closed.
    - Add a short "Phase 6b" subsection describing the notification bell + admin UI.
    - Commit: `docs(template): update claude.md to reflect phase 6b completion`

13. **Final validation**
    - Typecheck + build + seed green.
    - Dev smoke: create a user → bell badge increments → open notifications list → mark as read → badge decrements.
    - Create a webhook subscription pointing at webhook.site → create another user → delivery lands in the detail page's deliveries log.
    - Test-ping button on detail page fires a synthetic delivery.
    - Rotate secret → new secret shown once.
    - Commit count: 12–13.

---

## Rollback plan

- Per-task: `git reset --soft HEAD~1`.
- Phase: `git checkout main && git branch -D phase-6b-events-ui`.
- No schema changes.

---

## Phase 6b open deviations (fill in during execution)

- [ ] Any emission point that proved too tangled to thread — note + defer.
- [ ] Any webhook event name referenced but not in the catalog — add or skip the emit.
- [ ] Any i18n key the UI references but I forgot to seed — note + fix.
