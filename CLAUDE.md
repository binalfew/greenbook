# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this template.

## Template Scope

This is a **living template** for building multi-tenant SaaS apps on React Router 7. It ships the domain-agnostic plumbing (auth, RBAC, multi-tenancy, settings, feature flags, i18n, events/jobs, SSO, privacy, PWA, observability, testing harness). Business domains go in forks.

The extraction plan that produced this template (`docs/superpowers/specs/2026-04-20-template-extraction-design.md`) landed in 15 phases, all merged. Each subsystem has a dedicated section below with its service/route file locations and documented deviations. New to the codebase? Read top-to-bottom. Looking for a specific pattern? Use the "Patterns by phase" table below to jump.

## Patterns by phase

| Phase | Subsystem                                                     | Look here                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Auth + RBAC + audit log                                       | `app/utils/auth/`, `app/services/{users,roles,permissions,two-factor}.server.ts`                                                                                                                                                                            |
| 2     | Multi-tenancy + invitations                                   | `app/routes/$tenant/_layout.tsx`, `app/services/{tenants,invitations,tenant-setup}.server.ts`, `app/utils/request-context.server.ts`                                                                                                                        |
| 3     | Settings + feature flags + business hours                     | `app/services/{settings,business-hours}.server.ts`, `app/utils/config/{settings,feature-flags}.server.ts`                                                                                                                                                   |
| 4     | i18n                                                          | `app/utils/i18n.ts`, `app/locales/`, `app/utils/i18n-cookie.server.ts`                                                                                                                                                                                      |
| 5     | Components library                                            | `app/components/form.tsx`, `app/components/data-table/`, `app/hooks/use-cascade.ts`                                                                                                                                                                         |
| 6     | Events + jobs + webhooks + SSE + notifications                | `app/utils/events/`, `app/services/{webhooks,webhook-dispatcher,webhook-delivery,notifications}.server.ts`, `server/sse.ts`                                                                                                                                 |
| 7     | Saved views + custom fields + search + export                 | `app/services/{saved-views,custom-fields,search,data-export}.server.ts`, `app/services/view-filters.server.ts`                                                                                                                                              |
| 8     | Reference data (Country/Title/Language/Currency)              | `app/services/reference-data.server.ts`, `app/routes/$tenant/settings/references/`                                                                                                                                                                          |
| 9     | Privacy (DSAR + consent) + audit-log UI                       | `app/services/privacy.server.ts`, `app/routes/$tenant/settings/privacy/`, `app/routes/$tenant/logs/`                                                                                                                                                        |
| 10    | SSO (OIDC + SAML)                                             | `app/services/sso.server.ts`, `app/utils/auth/{oidc,saml,sso-state}.server.ts`, `app/routes/_auth/sso/`, `app/routes/$tenant/settings/sso/`                                                                                                                 |
| 11    | PWA + offline                                                 | `public/sw.js`, `public/manifest.json`, `app/utils/offline/`, `app/components/{offline-banner,pwa/*}.tsx`                                                                                                                                                   |
| 12    | Testing harness                                               | `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `tests/`                                                                                                                                                                        |
| 13    | Observability (logger/correlation/rate limit/Sentry/shutdown) | `app/utils/monitoring/`, `app/middleware/correlation.server.ts`, `server/{logger,correlation,request-logger,security,rate-limit-audit,sentry,shutdown}.{js,ts}`                                                                                             |
| 14    | Notes demo entity                                             | `app/services/notes.server.ts`, `app/routes/$tenant/notes/`                                                                                                                                                                                                 |
| app   | Directory (Greenbook domain — AU Blue Book)                   | `app/services/{organizations,people,positions,position-assignments,directory-changes,public-directory}.server.ts`, `app/routes/$tenant/directory/`, `app/utils/{directory-access,directory-submit,directory-routes}.server.ts`, `app/components/directory/` |

Each phase also appears as its own heading below with the subsystem's shape, conventions, and deviations captured when the code landed.

## Build & Development Commands

```bash
npm run dev              # Start dev server (Express + Vite HMR)
npm run build            # Production build
npm run start            # Production server
npm run typecheck        # react-router typegen && tsc -b
npm run lint             # tsc -b --noEmit
npm run format           # Prettier format all files
```

### Database

```bash
npm run docker:up        # Start PostgreSQL (dev on :5432, test on :5433)
npm run docker:down      # Stop containers
npm run db:push          # Sync Prisma schema to DB (template workflow — no migration files)
npm run db:seed          # Seed roles, permissions, feature flags, reference data, demo users
npm run db:studio        # Prisma Studio GUI
```

> The template uses `prisma db push` rather than `prisma migrate`. No migration files are versioned. Apps adopting the template should generate their own migration baseline (`npx prisma migrate dev --create-only --name init`) when they're ready to lock down schema changes.

### Testing

```bash
npm run test             # Unit tests (vitest)
npm run test:watch       # Unit tests in watch mode
npm run test:coverage    # Unit tests with coverage
npm run test:integration # Integration tests against test DB (port 5433)
npm run test:e2e         # Playwright E2E
npm run test:e2e:ui      # Playwright with UI
```

See the "Testing harness (Phase 12)" section for setup file layout, runner tiers, MSW handler registration, and factory usage. `tests/unit/example.test.ts` + `tests/integration/example.test.ts` + `tests/e2e/smoke.spec.ts` are exercise-the-harness stubs — delete when you add real coverage.

## Architecture

### Stack

- **Framework:** React Router 7 with SSR, Express server, Vite bundler
- **Database:** PostgreSQL via Prisma 7 with `@prisma/adapter-pg` driver adapter
- **UI:** shadcn/ui + Radix primitives + Tailwind CSS 4 + lucide-react
- **Forms:** Conform (`@conform-to/react` + `@conform-to/zod/v4`) with Zod v4
- **Auth:** Cookie-based sessions with DB backing, optional 2FA (TOTP + recovery codes), API keys with rate-limit tiers, SSO (OIDC + SAML)
- **Events/jobs:** in-process Postgres-backed queue (`FOR UPDATE SKIP LOCKED`), idempotency keys, domain events, webhooks with HMAC signatures, SSE for real-time UI
- **Observability:** pino logger, AsyncLocalStorage correlation IDs, Sentry (client + server), rate-limit audit trail
- **i18n:** i18next with en + fr, cookie-persisted, 13 namespaces
- **PWA:** service worker (cache-first static / network-first API / offline fallback), install + update prompts, IndexedDB sync queue
- **Testing:** vitest (unit + integration against a dedicated `db-test` Postgres on :5433) + Playwright (E2E + smoke project) + MSW mocks

### Project Layout

- `app/routes/` — File-based routing via `react-router-auto-routes`. Folders prefixed with `+` are ignored by auto-routes (intended for `+shared/` editor patterns arriving in later phases).
- `app/components/ui/` — shadcn/ui components (do not edit; use `npx shadcn add`).
- `app/components/` — Custom components.
- `app/utils/` — Core utilities, organized into subdirectories. Files ending in `.server.ts` are server-only.
  - `app/utils/auth/` — session, verification, CSRF, honeypot, user helpers, permissions, API keys, OIDC/SAML, audit
  - `app/utils/db/` — Prisma client with Postgres adapter wiring
  - `app/utils/email/` — email sending via Resend
  - `app/utils/config/` — environment variable parsing, settings SDK, feature-flag SDK + client-safe keys
  - `app/utils/events/` — job queue, domain event bus, webhook emitter, idempotency
  - `app/utils/monitoring/` — pino logger + Sentry (client + server)
  - `app/utils/offline/` — service-worker registration + IndexedDB sync queue
  - `app/utils/schemas/` — cross-cutting Zod schemas (privacy, sso, notes)
  - `app/utils/constants/` — enum key lists + color maps for status badges
- `app/middleware/` — request-scoped helpers (correlation ID + AsyncLocalStorage)
- `app/services/` — business logic (one file per domain, `.server.ts`)
- `app/locales/` — i18n JSON (en/ + fr/), one file per namespace, registered in `utils/i18n.ts`
- `app/hooks/` — client hooks (`use-base-prefix`, `use-cascade`, `use-sse`, `use-online-status`)
- `server/` — Express app boot + middleware (logger, correlation, rate limit, Sentry, shutdown).
- `public/` — static assets (`sw.js`, `manifest.json`, icons).
- `prisma/schema.prisma` — Database schema.
- `prisma.config.ts` — Prisma 7 configuration file (datasource URL lives here, not in schema).
- `tests/` — `unit/`, `integration/`, `e2e/`, and `setup/`. Currently empty pending later phases.

Path alias: `~/*` maps to `./app/*`.

## Code Conventions

- **Formatting:** Prettier — double quotes, semicolons, trailing commas, 100-char width, 2-space indent.
- **Commits:** Conventional Commits enforced by commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`. Max subject 100 chars.
- **Pre-commit:** Husky + lint-staged runs Prettier on staged files. Git `core.hooksPath` points to `react-router/.husky` (the templates repo is a monorepo of templates; hooks are scoped to this template).
- **Server-only code:** `.server.ts` suffix — excluded from client bundles by React Router.
- **Node version:** 22 (leverages native TypeScript support via type stripping).

## Core patterns reference

Every pattern the template teaches has a dedicated section below. Quick index for common tasks:

| Task                                | Canonical example                                           | Docs                                             |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Add a new CRUD entity               | `app/routes/$tenant/notes/`                                 | "Demo entity — Notes (Phase 14)"                 |
| Wire a form                         | `app/routes/$tenant/notes/+shared/note-editor.tsx`          | "Components (Phase 5)" + "Action error-handling" |
| Dialog overlay on a detail page     | `app/routes/$tenant/notes/$noteId.delete.tsx`               | "Dialog route pattern"                           |
| Trailing-underscore escape          | `app/routes/$tenant/notes/$noteId_/edit.tsx`                | "Entity route structure"                         |
| Cascading selects                   | `app/hooks/use-cascade.ts` + existing consumers             | "Cascading dropdowns"                            |
| Tenant-scoped list with filters     | `app/routes/$tenant/notes/index.tsx`                        | "Data patterns (Phase 7)"                        |
| Background job                      | `app/utils/events/job-handlers.server.ts`                   | "Events & Jobs (Phase 6)"                        |
| Webhook emission                    | `app/services/webhooks.server.ts`                           | "Events & Jobs (Phase 6)"                        |
| Gate by feature flag                | `requireFeature(request, "FF_NAME")`                        | "Settings + flags (Phase 3)"                     |
| RBAC check                          | `requirePermission(request, "resource", "action")`          | "Auth + RBAC (Phase 1)"                          |
| Structured logging with correlation | `getRequestLogger()` from `~/middleware/correlation.server` | "Server hardening (Phase 13)"                    |

The per-phase sections below document each subsystem's shape, conventions, open deviations, and known-tradeoff decisions. The "deviations" bullets at the end of each section are the single most useful thing to skim before starting new work — they flag the places where the template deliberately stopped short and what a fork needs to add.

## When Helping Users Build Apps From This Template

- **Follow existing patterns** — this CLAUDE.md documents the canonical shape of each subsystem and grows as patterns land.
- **Keep the `.server.ts` boundary clean** — never import `.server.ts` code from client-only modules.
- **Respect the `+` prefix** — folders like `app/routes/+shared/` are deliberately ignored by auto-routes and used to colocate shared editor components with their routes.
- **Don't reintroduce `app/lib/`** — Phase 0 moved all utilities into `app/utils/` with domain subdirectories. The flat `lib/` layout is legacy.

## i18n

The template ships `en` and `fr` locales across seven namespaces: `common`, `auth`, `validation`, `nav`, `settings`, `users`, `notifications`. Language state is persisted in the `i18n_lang` cookie (1-year TTL). The `<LanguageSwitcher>` in the tenant top-nav is gated on the `FF_I18N` feature flag and the per-tenant `i18n.supported_languages` setting.

### Adding a new locale namespace

When adding a new locale namespace (e.g., `app/locales/en/work-orders.json`), you **MUST** also register it in `app/utils/i18n.ts`:

1. Import the JSON files for every shipped language.
2. Add them to the `resources` object under each language.
3. Add the namespace name to the `NAMESPACES` array.

Without this registration, `useTranslation("new-namespace")` silently falls back to displaying the raw key names — a subtle failure mode that's obvious only once a human looks at the UI.

### Adding a new locale

1. Create `app/locales/<code>/` with one JSON file per namespace (copy from `en/`).
2. In `app/utils/i18n.ts`, add the entry to `supportedLanguages` (with `dir` for LTR/RTL).
3. Import each JSON file and register under the `resources` map.
4. Update the tenant's `i18n.supported_languages` setting to include the new code.

### Generic labels

Generic UI labels (back, edit, delete, save, cancel, add, new, on, off) live in `common.json` only. Never duplicate them in a module namespace; reference via `t("back", { ns: "common" })` or pair a second `useTranslation("common")` hook at the top of the component (pattern used throughout `_auth/*.tsx`).

## Components (Phase 5)

The template ships a component library. Prefer these entry points when writing new routes — they're the canonical patterns referenced by later phases.

### Form handling

Import `useForm`, `getInputProps`, `getTextareaProps`, `getSelectProps`, `getFormProps`, and every field wrapper from `~/components/form`. The wrapper uses the **stable** Conform API (`@conform-to/react` + `@conform-to/zod/v4`) and centralises `shouldValidate`, `shouldRevalidate`, `constraint`, and client-side Zod validation. It returns `{ form, fields, intent }` — `intent` is an alias for `form` (stable `FormMetadata` exposes `.update()`, `.reset()`, `.validate()` directly).

Field wrappers (`CheckboxField`, `SwitchField`, `RadioGroupField`, `DatePickerField`, `SelectField`/`SearchableSelectField`) bridge shadcn/Radix components with a hidden native input via `unstable_useControl`. `SelectField` supports three prop shapes: client-side `options`, server-side `fetchUrl` (debounced search, label resolution on edit forms), and fully controlled (no Conform) for non-form consumers.

Every route — auth, tenant-scoped, settings — goes through `~/components/form` + shadcn `<Field>` / `<FieldLabel>` / `<FieldError>` composed directly. The earlier `~/components/field` (`FormField`) + `input-field` / `checkbox-field` / `textarea-field` surface was retired in a post-Phase-15 cleanup; if you see one in a downstream fork, migrate it to the canonical pattern so there's only one way to wire a form.

### Cascading dropdowns

Use `useCascade` from `~/hooks/use-cascade` for dependent selects (e.g., property → building → floor). The hook owns fetcher lifecycle, key-based remounts, and Conform value clearing. Root levels omit `parent`; child levels pass another binding as `parent` plus `buildUrl`, `intent`, and optional placeholders. Never manage cascade state with `useState` / `useEffect` / `useRef` in consumers.

### Base-prefix URLs

Use `useBasePrefix` from `~/hooks/use-base-prefix` inside components that need `/${tenant}` or `/admin` URL prefixes (resource route URLs for `SearchableSelectField.fetchUrl`, `useCascade.buildUrl`, etc.).

### DataTable

`~/components/data-table/data-table` exports `DataTable`, a custom list-page component with tree/hierarchy rows, URL-driven search + filters, selectable rows, and permission-gated row/bulk/toolbar actions. It uses a project-local `ColumnDef<TData>` type (not tanstack) — see `~/components/data-table/data-table-types`.

Permission gating is opt-in: pass `canPerformAction={(permission) => …}` to filter actions. When omitted, every action declaring a `permission` is hidden (fail-closed default).

Alternate view renderers (kanban, calendar, gallery) are not implemented in Phase 5; the `viewType` / `viewConfig` prop shape is preserved for forward-compat with a saved-views phase. Passing `viewType !== "TABLE"` falls through to the table renderer.

### UI primitives

Phase 5 added: `~/components/ui/switch`, `radio-group`, `calendar`, `empty-state`, `native-select`, `info-row`, `date-picker`, `date-time-picker`. The `date-picker` / `date-time-picker` are standalone widgets with a hidden `name` input that work in plain `<Form>` submissions — use `DatePickerField` from `~/components/form` when integrating with Conform.

## Events & Jobs (Phase 6)

The template ships a background-jobs, SSE, webhook, and notification stack. Entry points:

### Job queue

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

### Domain events

Services emit domain events through `emitDomainEvent(tenantId, eventType, data)` from `app/utils/events/emit-domain-event.server.ts`. This is **fire-and-forget** — it calls `emitSSE` (real-time UI) and `emitWebhookEvent` (external consumers) and suppresses errors so the caller's write path never blocks on a slow webhook.

**Rule: services emit, routes never emit directly.** Keep the routes thin.

```ts
// In a service after a successful write:
await prisma.user.create({ data: { ... } });
emitDomainEvent(tenantId, "user.created", { id: user.id, email: user.email });
```

### Webhook subscriptions

`app/services/webhooks.server.ts` — subscription CRUD + pause/resume + rotate-secret + test-endpoint. `webhook-dispatcher.server.ts` fans an event out to matching subscriptions and fires `deliverWebhook` asynchronously. `webhook-delivery.server.ts` signs the payload with HMAC-SHA256, POSTs with timeout, retries with per-subscription backoff, and opens a circuit breaker after `CIRCUIT_BREAKER_THRESHOLD` consecutive failures. Event names the template emits live in `app/utils/events/webhook-events.ts` — apps extend this catalog with their own.

Feature flag: `FF_WEBHOOKS` (default **off**). The emitter short-circuits when disabled.

### SSE

`server/sse.ts` exposes `emitSSE({ type, tenantId, userId?, data })`; `app/routes/$tenant/api/events.tsx` is the stream endpoint; `app/hooks/use-sse.ts` is the consumer hook. Events are scoped per-tenant, optionally per-user; cross-tenant leakage is blocked. 30-second heartbeats prevent proxy idle timeouts.

Feature flag: `FF_SSE` (default **on**).

### Notifications

`app/services/notifications.server.ts` — `createNotification`, `getUnreadCount`, `listNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`. Creating a notification emits an SSE `notification` event so the UI updates in real-time.

Feature flag: `FF_NOTIFICATIONS` (default **on**).

### Idempotency

Write API endpoints that accept `Idempotency-Key` headers wrap their handler in `withIdempotency(request, tenantId, handler)` from `app/utils/events/idempotency.server.ts`. 24-hour TTL, `(key, tenantId)` unique. A cache sweeper job is deferred to a later phase.

### Phase 6 open deviations

- No `logger.server.ts` exists yet — Phase 6 ports use `console.*` (info/warn/error). Phase 13 (server hardening) lands a real pino/winston logger; one grep-replace sweep there.

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

## Data patterns (Phase 7)

Phase 7 added the saved-views, custom-fields, search, and export infrastructure. UI (view switcher, custom-field designer, import/export screens) is deferred to Phase 7b.

### Saved views

`~/services/saved-views.server.ts` — per-user CRUD for persisted filter/sort/column state. A view belongs to a `(tenantId, userId, entityType)` tuple; setting one `isDefault` automatically clears others in the same scope.

`~/services/view-filters.server.ts` — `resolveViewContext(request, tenantId, userId, entityType, fieldMap)` is the helper for list-page loaders. It reads `?viewId` (or falls back to the user's default view), translates filters/sorts into Prisma `where`/`orderBy` clauses using the caller-provided `fieldMap`, and honours `?sort`/`?dir` URL params as an override.

Gated on `FF_SAVED_VIEWS` (default **off**). When disabled, `resolveViewContext` returns an empty context and the list page falls back to URL-driven sort only.

### Custom field definitions

`~/services/custom-fields.server.ts` — tenant-scoped custom field metadata per `entityType`. Definitions store `fieldType` (TEXT / NUMBER / DATE / SELECT / BOOLEAN / TEXTAREA), optional `options` for SELECT, `defaultValue`, and `sortOrder`. Consumer entities read definitions via `getCustomFieldsForEntity(tenantId, entityType)` and persist values in their own `metadata` JSON field.

No UI in Phase 7 — a field-designer admin page arrives in Phase 7b.

### Search

`~/services/search.server.ts` — `globalSearch(query, tenantId, { limit? })` scans users, roles, permissions, and audit logs with case-insensitive `contains` matching. Returns a unified `SearchResult[]`. Apps extending the template add their own entity searches and compose with the template's helper.

### Export

`~/services/data-export.server.ts` — `rowsToExport(rows, entity, format)` converts any array of plain-object rows to a CSV (RFC 4180 quoting) or JSON payload. Per-entity wrappers `exportUsers` and `exportRoles` ship; `exportEntity(entity, tenantId, format)` dispatches. Apps add more entities by extending the switch in their own export helper.

### Soft delete

The template's soft-delete convention is per-service: write callers use `deletedAt: new Date()` and read callers filter `{ deletedAt: null }`. No Prisma extension — the pattern is explicit to keep developers aware that deleted rows are still queryable when needed (admin tools, undelete flows, audit reconciliation).

### Feature flags + permissions

- `FF_SAVED_VIEWS` (tenant-scope, default off) gates `resolveViewContext` from returning active-view data.
- Permissions: `saved-view:{read,write,delete}` and `custom-field:{read,write,delete}` seeded in `UNIQUE_PERMISSIONS`; admin role gets them automatically.

## Data pattern UIs (Phase 7b)

Phase 7b adds the admin screens and reusable components that activate Phase 7a's infrastructure:

### Custom fields admin

`$tenant/settings/custom-fields/` — full CRUD for `CustomFieldDefinition` rows. Uses the Phase 5 shared-editor pattern (`+shared/custom-field-editor.tsx` + `.server.tsx` + `custom-field-schema.ts`). Field types rendered in a native select: TEXT / NUMBER / DATE / SELECT / BOOLEAN / TEXTAREA. SELECT fields accept one option per line in a textarea. Settings sidebar gained a "Custom fields" entry (always visible — definitions are just metadata).

### ViewSwitcher component

`~/components/view-switcher.tsx` — dropdown toolbar control that renders available saved views, picks one via `?viewId=...`, and triggers save/delete/set-default actions. Consumers render it via a list-page DataTable's `toolbarExtra` slot and wire it to the `ViewContext` returned by `resolveViewContext`.

Paired resource routes at `$tenant/api/saved-views/`:

- `new.tsx` — full-page form that snapshots the referring URL's filter + sort params and writes a `SavedView`. Redirects back with `?viewId=<new>`.
- `$viewId.delete.tsx` — POST-only, deletes the view (honours the service's own-view-only check).
- `$viewId.set-default.tsx` — POST-only, toggles `isDefault`.

All three are gated on `FF_SAVED_VIEWS` via `requireFeature`. Deletions redirect back to the referrer with `viewId` stripped.

Consumer pattern in a list page:

```tsx
import { resolveViewContext } from "~/services/view-filters.server";
import { ViewSwitcher } from "~/components/view-switcher";

// loader:
const viewContext = await resolveViewContext(request, tenantId, userId, "asset", FIELD_MAP);
const items = await prisma.asset.findMany({ where: { tenantId, ...viewContext.viewWhere } });
return data({ items, viewContext });

// component:
<DataTable
  data={items}
  columns={columns}
  toolbarExtra={
    viewContext.savedViewsEnabled ? (
      <ViewSwitcher
        tenantSlug={tenant.slug}
        entityType="asset"
        activeViewId={viewContext.activeViewId}
        availableViews={viewContext.availableViews}
      />
    ) : undefined
  }
/>;
```

### ExportButton component

`~/components/export-button.tsx` — dropdown that renders CSV + JSON download links pointing at the caller's export URL (`?format=csv|json`). Consumers wire it to a tenant-scoped resource route that calls `exportEntity(entity, tenantId, format)` from Phase 7a's `data-export.server.ts` and returns the payload with `Content-Disposition: attachment`.

### i18n

New namespaces: `custom-fields` (30 keys) and `saved-views` (14 keys). Both registered in `~/utils/i18n.ts`.

## Reference data (Phase 8)

Phase 8 ships four tenant-scoped reference-data entities: `Country`, `Title`, `Language`, `Currency`. Each row belongs to a tenant and is uniquely keyed by `(tenantId, code)`. Used as lookup lists in forms throughout the app.

### Service

`~/services/reference-data.server.ts` — CRUD per entity (`listX`, `listXPaginated`, `getX`, `createX`, `updateX`, `deleteX`) plus a dashboard helper `getReferenceDataCounts(tenantId)`. Duplicate-code errors throw `ReferenceDataError` with `code: "DUPLICATE_CODE"` so callers can surface field-level validation errors.

### Seed

`prisma/seed.ts` exports `seedReferenceData(tenantId)` and calls it for the system tenant on initial seed. Default sets:

- 8 countries (US, GB, FR, DE, ET, CA, JP, AU)
- 5 titles (Mr., Mrs., Ms., Dr., Prof.)
- 7 languages (English, French, German, Spanish, Arabic, Amharic, Chinese)
- 7 currencies (USD, EUR, GBP, JPY, ETB, CAD, AUD)

Apps building on the template call `seedReferenceData(newTenant.id)` from their tenant-provisioning helper to give new tenants a baseline.

### Admin UI

`$tenant/settings/references/` — index page shows counts + "Manage" links for each type. Full CRUD admins ship for all four: `countries/`, `titles/`, `languages/`, `currencies/`. Each uses the Phase 5 shared-editor pattern with its own schema and editor (`+shared/<entity>-editor.tsx` + `.server.tsx` + `<entity>-schema.ts`). Per-entity forms tune for the extra columns: countries include `alpha3` / `numericCode` / `phoneCode` / `flag`; languages add `nativeName`; currencies add `symbol` + `decimalDigits`.

### Feature flags + permissions

- No feature flag — reference data is always on.
- Permissions: `reference-data:{read,write,delete}` seeded in `UNIQUE_PERMISSIONS`; admin role gets them automatically.

### i18n

New namespace: `references` (27 keys). `settings.json` gained `navReferences` in en + fr.

## Privacy & audit (Phase 9)

Phase 9 layers GDPR-style privacy primitives and an audit-log UI on top of the existing `AuditLog` model (shipped in Phase 1) + `writeAudit` helper.

### Schema

Two new tenant-scoped models added to `prisma/schema.prisma`:

- `DataSubjectRequest` — tracks DSAR workflow (`SUBMITTED` → `IDENTITY_VERIFICATION` → `IN_PROGRESS` → `COMPLETED`/`DENIED`/`CANCELLED`). Columns: `requestType` (`ACCESS`/`RECTIFICATION`/`ERASURE`/`RESTRICTION`/`PORTABILITY`/`OBJECTION`), `subjectEmail`, optional `subjectUserId`, `description`, `responseNotes`, `processedById` (FK to `User`, `SetNull`), `submittedAt`, `completedAt`, `deadlineAt` (defaults to submission + 30 days), `exportUrl`.
- `ConsentRecord` — tenant + user + purpose unique key. Tracks `lawfulBasis` (`CONSENT`/`CONTRACT`/`LEGITIMATE_INTEREST`/`LEGAL_OBLIGATION`), `isGranted`, `grantedAt`, `revokedAt`, optional `expiresAt` and `source`.

Back-relations wired on `Tenant` (`dataSubjectRequests`, `consentRecords`) and `User` (`consentRecords`, `dsrsProcessed` via the `"DSRProcessor"` named relation). Applied via `npx prisma db push --accept-data-loss` (template workflow — no migration file yet).

### Service

`~/services/privacy.server.ts` (~330 lines):

- **DSR:** `listDSRsPaginated`, `getDSR`, `submitDSR`, `processDSR`, `completeDSR`, `denyDSR`, `deleteDSR`.
- **Consent:** `listConsents`, `recordConsent` (upsert on `(tenantId, userId, purpose)`), `revokeConsent`, `hasConsent`.
- **Dashboard:** `getPrivacyDashboard(tenantId)` returns DSR counts (total/pending/overdue/completed/denied), consent counts (total/granted/revoked), and the 5 most recent DSRs.
- State-transition rules enforced in the service — `processDSR` only from `SUBMITTED`/`IDENTITY_VERIFICATION`; `completeDSR` only from `IN_PROGRESS`; `denyDSR` blocked from terminal states; `deleteDSR` blocked from `IN_PROGRESS`. Invalid transitions throw `PrivacyError` with a status code and `code` (`INVALID_STATUS_TRANSITION`, `CANNOT_DELETE_IN_PROGRESS`, etc.).

### Schemas + constants

- `~/utils/schemas/privacy.ts` — `createDSRSchema`, `completeDSRSchema`, `denyDSRSchema`, `recordConsentSchema`. `purpose` is a generic `z.string()` with 100-char cap — apps can feed any purpose string without schema edits.
- `~/utils/constants/privacy.ts` — `DSR_TYPE_KEYS` / `DSR_STATUS_KEYS` / `CONSENT_PURPOSE_KEYS` / `LAWFUL_BASIS_KEYS` as `readonly` tuples, plus per-key color maps for the badge renders. Consent purpose defaults shipped: `marketing_emails`, `analytics`, `third_party_sharing`, `cookies`, `newsletter`, `user_content`. Apps extend with additional purpose strings — the `purpose` column is `VarChar(100)` and doesn't enforce membership.

### Routes

- `$tenant/settings/privacy/index.tsx` — dashboard with DSR + consent KPI tiles and recent-DSRs table.
- `$tenant/settings/privacy/requests/` — DataTable index, `new.tsx` (`submitDSR`), `$requestId/index.tsx` (detail + intent-button workflow actions `process`/`complete`/`deny`), `$requestId/delete.tsx`.
- `$tenant/settings/privacy/consents/index.tsx` — DataTable listing with user search + purpose/granted filters (no write UI in the template — apps call `recordConsent` from their signup/settings flows).
- `$tenant/logs/` — audit-log admin. `index.tsx` renders a DataTable with KPI cards (actions today, deletes this week, total records), search, action/entity/user/date filters, and a CSV export that streams up to 10k rows. `$logId/index.tsx` shows a detail page with `InfoRow` grid + metadata JSON preview.

### Permissions

Added to `UNIQUE_PERMISSIONS` in `prisma/seed.ts` (module: `privacy`):

- `privacy:{read,write,delete}` — gates the DSR + consent routes.
- `audit-log:read` — gates the `/logs` admin.

Admin role picks them up automatically on seed.

### Navigation

- Top tenant nav gains a "Logs" `NavLink` (next to Settings) — text resolved from `nav.logs`.
- Settings sidebar gains a "Privacy" entry below "Reference data" — text resolved from `settings.navPrivacy`. Always visible (privacy is a compliance concern, not a feature-flaggable subsystem).

### i18n

Two new namespaces registered in `~/utils/i18n.ts`:

- `privacy` (~90 keys) — dashboard, DSR list/detail/delete, consent list, purposes, lawful bases, DSR types + statuses.
- `logs` (~25 keys) — audit-log admin + detail UI strings.

`nav.json` gets a `logs` entry (en + fr). `settings.json` gets a `navPrivacy` entry (en + fr).

### Deviations

- **Consent write UI deferred.** The template ships read-only consent management — the service exposes `recordConsent`/`revokeConsent` but there's no admin form for operators to grant/revoke consent on behalf of users. Apps typically call `recordConsent` from signup, cookie-banner acceptance, or per-user settings pages — wiring a generic admin form would force choices (which purposes? which users? with what lawful basis?) that belong to the consuming app.
- **DSR detail uses intent-button fetcher forms** rather than a separate action route for each transition. This keeps the happy path (status → button → POST same route → loader re-runs) tight. The `deny` button currently submits with a canned reason — a dedicated "deny with notes" flow is a future enhancement.
- **No CSV export for DSRs or consents yet.** Logs have CSV export because audit logs get large fast and external retention is common. DSR/consent exports can be added via Phase 7b's `ExportButton` if needed.
- **CSV export streams via an `export=csv` search-param branch in the same loader** rather than a separate resource route. Works, but pushes CSV-shaping logic into the page loader. If export needs grow (column config, async jobs), factor out to `$tenant/api/logs-export.tsx`.
- **Audit log emission is still sparse.** Phase 1 shipped `writeAudit` and the `AuditLog` model; phases 2–8 intentionally left call-site emission to the consuming app. A future phase (or per-service pass) can sprinkle `writeAudit` through the template's CRUD paths.
- **No per-entity deep links from the audit-log detail page.** Entity IDs render as plain monospace strings. Apps that want clickable entity links can wrap the detail page and add their own entity-to-URL map keyed on `entityType`.
- **`audit-log` has no `write`/`delete` permissions** — audit logs are append-only; deletion is a governance concern that belongs in a dedicated retention workflow, not in the admin UI.
- **Still no logger.** All Phase 9 additions use `console.*`. Phase 13 sweeps.

## SSO (Phase 10)

Phase 10 adds enterprise SSO — both OpenID Connect (OIDC) and SAML 2.0 — with full tenant-scoped admin UI and the authentication flow wired end-to-end.

### Packages

- `openid-client@^6` — OIDC discovery + PKCE + token exchange.
- `samlify@^2` — SAML 2.0 AuthnRequest generation + Response validation + attribute extraction.

### Schema

Two new tenant-scoped models + two enums added to `prisma/schema.prisma`:

- `SSOProvider` enum — `OKTA` / `AZURE_AD` / `GOOGLE` / `CUSTOM_OIDC` / `CUSTOM_SAML`.
- `SSOProtocol` enum — `OIDC` / `SAML`.
- `SSOConfiguration` — one row per IdP per tenant. Stores OIDC fields (`clientId`, `clientSecret`, `issuerUrl`, `metadataUrl`), SAML fields (`ssoUrl`, `x509Certificate`, `spEntityId`, `nameIdFormat`), plus `callbackUrl`, `autoProvision`, `enforceSSO`, `defaultRoleId`, `isActive`.
- `SSOConnection` — one row per (user, provider, tenant). Tracks the IdP's `providerUserId` + last login.

Back-relations: `Tenant.ssoConfigurations`, `Tenant.ssoConnections`, `User.ssoConnections`. Applied via `db push --accept-data-loss` (no migration file — template workflow).

### Utilities

- `~/utils/auth/oidc.server.ts` — openid-client v6 wrapper. Exports `discoverOIDCProvider` (cached 10 min), PKCE helpers (`generateCodeVerifier`, `generateCodeChallenge`), `generateState`, `generateNonce`, `buildAuthorizationUrl`, `exchangeCodeForClaims`, and a dry-run `testOIDCDiscovery` for the "Test Connection" button.
- `~/utils/auth/saml.server.ts` — samlify wrapper. Exports `buildSAMLRedirectUrl`, `validateSAMLResponse`, `generateRequestId`, `generateSAMLState`, `testSAMLConfiguration`. `samlify.setSchemaValidator` is set to permissive (signature validation still runs internally via xml-crypto).
- `~/utils/auth/sso-state.server.ts` — short-lived (10-min) cookie session storage (`__sso_state`) plus HMAC-signed SAML RelayState encoding. The SAML path encodes flow state into `RelayState` instead of cookies because SAML IdPs POST back cross-origin and `sameSite=lax` cookies don't traverse that.
- `~/utils/schemas/sso.ts` — `createSSOConfigSchema` Zod validator covering both protocols' fields (all optional-per-protocol, service enforces required subset).
- `~/utils/constants/sso.ts` — `SSO_PROVIDER_OPTIONS`, `SSO_PROTOCOL_OPTIONS`, `IDP_INSTRUCTIONS` (setup guides per provider, including Okta-SAML + Azure-AD-SAML variants).

### Service

`~/services/sso.server.ts` (~680 lines):

- **CRUD:** `getSSOConfigurations(tenantId)`, `getSSOConfigById`, `createSSOConfiguration`, `updateSSOConfiguration` (preserves `clientSecret` when not provided), `deleteSSOConfiguration`, `getSSOConnectionCount*`.
- **Test:** `testSSOConfiguration(id)` — dispatches to `testOIDCDiscovery` or `testSAMLConfiguration` based on protocol. Returns `{ success, error? }`.
- **Flow initiation:** `initiateSSOFlow(configId, tenantSlug, redirectTo)` — builds authorization URL + captures state/nonce/PKCE/requestId; caller persists flow state via cookie (OIDC) or RelayState (SAML).
- **Callback:** `handleSSOCallback({ protocol, ...params })` — dispatches to `handleOIDCCallback` (exchanges code for claims, calls `resolveOrProvisionUser`) or `handleSAMLCallback` (validates SAML Response, extracts `nameId`/email/name).
- **Linking:** `linkSSOAccount` / `linkSAMLAccount` — adds an `SSOConnection` row for an already-authenticated user without creating a new session.
- **User resolution (`resolveOrProvisionUser`):** (1) existing `SSOConnection` → update last-login, check `userStatus.code === "ACTIVE"`, check tenant; (2) existing user by case-insensitive email → create connection, guard cross-tenant; (3) auto-provision iff `autoProvision` is true — creates user with `userStatusId` → ACTIVE, splits the IdP `name` claim into `firstName`/`lastName`, optionally assigns `defaultRoleId`. All inside a `$transaction`.

### Routes

**Authentication flow** (under `_auth/` → URL-visible at `/sso/*`, no tenant prefix):

- `/sso/start?tenant=<slug>&configId=<id>[&link=true]` — loader-only redirect. Looks up the SSO config, mints PKCE/state, stores flow state (cookie for OIDC, signed RelayState for SAML), redirects to the IdP.
- `/sso/callback` — GET loader handles OIDC; POST action handles SAML (cross-origin POST from the IdP). Validates state/nonce, exchanges code (OIDC) or validates Response (SAML), writes a `LOGIN` audit entry via `writeAudit`, deletes any existing user sessions (single-session model), creates a new `Session` row via `getSessionExpirationDate()`, sets the `sessionKey` cookie, redirects to `flowState.redirectTo || /<tenantSlug>`. Renders a standalone "Sign-in Failed" page when the callback rejects (the error page is also the loader's fallback UI).

**Admin** (under `$tenant/settings/sso/`):

- `index.tsx` — DataTable with provider/protocol/status columns, search across displayName/provider/issuerUrl, filters for protocol + active/inactive, connection-count per provider (via `groupBy`).
- `new.tsx` — full form with OIDC Configuration + SAML Configuration + Provisioning cards; setup-guide accordion shows per-provider IdP instructions (using native `<details>` for now — template has no `Collapsible` component). Callback URL computed from `process.env.APP_URL`.
- `$ssoConfigId/index.tsx` — detail page with: header badges (provider/protocol/status), KPI strip (linked users, auto-provision, enforce, protocol), Configuration card (masks `clientId`/`clientSecret`), Test Connection card with fetcher-posted intent button, IdP instructions panel.
- `$ssoConfigId/edit.tsx` — same form as `new.tsx` but prefilled. `clientSecret` left blank preserves existing (placeholder "Leave blank to keep existing").
- `$ssoConfigId/delete.tsx` — destructive-confirm page. If `connectionCount > 0`, shows an amber warning that linked users will lose SSO sign-in.

### Env

`~/utils/config/env.server.ts` gains `APP_URL` (default `http://localhost:5173`). The service uses it to build callback URLs (`${APP_URL}/sso/callback`) and default SP entity IDs.

### i18n

New namespace `sso` (~55 keys, en + fr), registered in `~/utils/i18n.ts`. `settings.json` gets a `navSso` entry (en + fr). Login-page SSO button copy isn't shipped — apps wire their own tenant-conditional "Sign in with SSO" affordance against `getSSOConfigurations(tenantId)`.

### Permissions

Added to `UNIQUE_PERMISSIONS` under module `auth`:

- `sso:{read,write,delete}` — gate the admin surfaces. `read` also gates the Test Connection action.

Admin role picks them up automatically on seed.

### Navigation

Settings sidebar gains "SSO" under "Privacy" (always visible — no feature flag).

### Deviations

- **No feature flag.** The natural gate is "does this tenant have an active config". Adding `FF_SSO` would mean hiding the admin from global admins who need to configure it first — awkward. If a fork wants a full kill-switch, wrap the three read/write/delete actions in `requireFeature`.
- **Login page shows no "Sign in with SSO" button by default.** The auth flow works via direct navigation to `/sso/start?tenant=X&configId=Y` — apps that want a button on their login page should query `getSSOConfigurations(tenant.id)` in the login loader and render buttons per active config. Kept out of the template to avoid forcing a UX decision (e.g. how to render multiple IdPs, whether to hide password login when `enforceSSO`).
- **`resolveOrProvisionUser` splits the IdP `name` claim** (`"Jane Doe"` → `firstName: "Jane", lastName: "Doe"`). Falls back to `firstName = email-local-part, lastName = ""` if the IdP sends no name. Apps that need stricter mapping (honorific prefixes, mononyms, CJK name order) should write a post-provision hook.
- **No `photoUrl` on the template's User model** — the IdP `picture` claim is still written to `SSOConnection.avatarUrl` but never copied to the User. Apps that want avatar display join through `ssoConnections` or extend the User model.
- **User activation is tracked via `userStatusId → UserStatus.code`.** The service checks `user.userStatus?.code === "ACTIVE"` before allowing a sign-in to complete.
- **`unlinkSSOAccount` + `getUserSSOConnections` are shipped but not wired** to any profile/settings UI yet. Apps that want users to manage their own SSO-linked accounts should build a `/profile/security` page calling these.
- **No custom-role check on `defaultRoleId`** — the admin form's role dropdown excludes `admin` (to prevent bootstrap privilege escalation) but other roles are fair game. Apps with sensitive roles should filter further at admin layer.
- **`env.APP_URL` defaults to `http://localhost:5173`** so dev works out-of-the-box. Production deploys MUST set it — SAML IdPs have to embed the callback URL in their metadata, and an IdP response targeting `localhost` will be routed out of the cluster.
- **Still no logger.** All Phase 10 additions use `console.info/warn/error`. Phase 13 sweeps.
- **No migration file.** Schema applied via `db push`. Migration baseline belongs in Phase 13.

## Offline / PWA (Phase 11)

Phase 11 ships a progressive web app surface: a service worker with cache-first/network-first strategies, a manifest for installability, an IndexedDB sync queue for queued mutations, install + update prompts, an offline banner, and a standalone `/offline` fallback page.

### Feature flag

Everything is gated on `FEATURE_FLAG_KEYS.PWA` (key `FF_PWA`, already defined in Phase 3). When off:

- No `<link rel="manifest">` rendered
- No `<meta name="theme-color">` / `mobile-web-app-capable`
- Service worker is not registered
- Install + update prompts don't render

Flip the flag on once you've customized `public/manifest.json` + provided icons. The offline banner in `$tenant/_layout.tsx` always renders (it's zero-cost when `navigator.onLine` is true), so your tenant-scoped pages show a non-blocking banner on connection loss regardless.

### Service worker

`public/sw.js` — vanilla worker, no build step. Three named caches (`static-v1`, `api-v1`, `pages-v1`) with cleanup on `activate`. Routing:

- **Navigation requests (`request.mode === "navigate"`)** — network-first; on failure, serve the cached `/offline` page.
- **`/api/**`requests** — network-first; on failure, serve cached response or a JSON`{"error":"offline"}` shell.
- **Static assets** (JS/CSS/font/image/`/assets/**`/`/icons/**`) — cache-first.

Bump the `-v1` suffix on each of the three cache-name constants when you change routing behavior so old clients invalidate cleanly via the `activate` handler.

### Install + update prompts

- `~/components/pwa/install-prompt.tsx` — listens for `beforeinstallprompt`, shows a dismissable card ≤ 15 s, calls `prompt()` on Install.
- `~/components/pwa/sw-update-prompt.tsx` — listens for a new worker landing `installed` while a controller exists (i.e. a background update), posts `SKIP_WAITING`, reloads. Dismissable ≤ 30 s.

Both are rendered from `root.tsx` when `pwaEnabled` is true, so they appear above every surface (tenant + auth + errors) without layout plumbing.

### Offline indicators

- `~/hooks/use-online-status.ts` — `useSyncExternalStore` over `online`/`offline` window events. Returns `true` on SSR.
- `~/components/offline-banner.tsx` — fixed-bottom yellow banner with `WifiOff` icon. Mounted in `$tenant/_layout.tsx`.
- `app/routes/offline.tsx` — full-page fallback at `/offline`. Rendered by the SW's navigation-fallback and precached on install.

### Sync queue

`~/utils/offline/sync-queue.ts` — small IndexedDB wrapper exposing `queueMutation`, `getQueuedMutations`, `removeMutation`. Intended pattern:

1. Mutation-side fetcher sees a network error → `queueMutation({ url, method, body })`.
2. Apps register a `"sync-mutations"` background-sync tag (`registration.sync.register("sync-mutations")`).
3. SW's `sync` handler broadcasts `{ type: "SYNC_REQUESTED" }` via `postMessage` to every open tab.
4. Client listens for that message → drains `getQueuedMutations()` → replays with `fetch()` → `removeMutation(id)` on success.

The replay loop itself is **not shipped** — each app knows how to re-issue its own requests (CSRF token refresh, redirects, error handling). This is infrastructure, not a turnkey system.

### Icons + manifest

Ship `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and `apple-touch-icon.png` (referenced in `manifest.json` + `root.tsx`). Template doesn't include real icons — generate them from your product logo before enabling `FF_PWA`.

Edit `public/manifest.json` to set `name`, `short_name`, `theme_color`, `background_color`.

### i18n

New namespace `pwa` (~12 keys, en + fr) registered in `~/utils/i18n.ts`. Covers offline banner, offline page, install prompt, and update prompt copy.

### Deviations

- **Sync replay is caller-responsibility.** The template ships the queue + the SW ping + the message plumbing. It doesn't ship `replayQueuedMutations()` because that function needs app-specific CSRF/cookie/redirect handling — a generic one would either not work or gaslight callers about edge cases.
- **Service worker is hand-written JS, not Workbox.** Keeps the template free of a build-integration dep. Apps with complex caching needs can swap in Workbox or `vite-plugin-pwa` without touching the `registerServiceWorker` call site.
- **Icons aren't bundled.** A default favicon exists, but not the maskable icon set the manifest references. Forking apps must ship their own.
- **No "Install" trigger for iOS.** `beforeinstallprompt` is Chromium-only. iOS users get the "Add to Home Screen" manual flow; the install-prompt component is silently absent for them.
- **No `Workbox`-style precache manifest.** The `PRECACHE_URLS` list in `sw.js` is hand-curated (`/offline`, `/manifest.json`, `/favicon.ico`). If bundler-generated asset URLs change across deploys, you still get them from the cache-first fetch handler — just not precached.
- **`theme-color` hardcoded to `#1e40af`** in both `manifest.json` and `root.tsx`'s `<meta>`. Apps customizing brand should update both.
- **Offline banner uses `fixed bottom`** regardless of tenant layout height; it overlays the bottom 30px of content when offline. A layout-aware banner is an app-level concern.
- **`registerServiceWorker` runs in an effect** so the worker registers after first render — no SSR interference. SW activation is asynchronous, so the first visit may land on the cached `/offline` page only after a reload.
- **Still no logger.** Phase 13 sweeps `console.*`.

## Testing harness (Phase 12)

Phase 12 fleshes out the placeholder test scaffolding with three runners (unit, integration, E2E), MSW HTTP mocks, test-data factories, and a dedicated test Postgres on port 5433.

### Runners

| Runner      | Config                         | What it tests                                                                                              | DB               |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------- |
| Unit        | `vitest.config.ts`             | Services + utils + schemas in isolation. Outbound HTTP stubbed by MSW.                                     | none             |
| Integration | `vitest.integration.config.ts` | Service layer against real Postgres. Truncates all tables `beforeEach`. Serial (`fileParallelism: false`). | `db-test` @ 5433 |
| E2E         | `playwright.config.ts`         | Full-stack happy paths via a real browser. Spins up `npm run dev` on port 3001 against the same test DB.   | `db-test` @ 5433 |

### Commands

```
npm run test               # unit, one-shot
npm run test:watch         # unit, watch mode
npm run test:coverage      # unit + v8 coverage report → tests/coverage/
npm run test:integration   # integration (needs db-test running)
npm run test:e2e           # E2E, chromium project (skips smoke)
npm run test:e2e:ui        # E2E with Playwright UI
```

### Setup files

- `tests/setup/unit-setup.ts` — starts MSW with `onUnhandledRequest: "bypass"`, resets handlers between tests. Flip to `"error"` for strict contract testing.
- `tests/setup/integration-setup.ts` — creates a Prisma client pointed at the test DB (via `@prisma/adapter-pg`), truncates all tables in a single `DO $$ … TRUNCATE CASCADE` block `beforeEach`, exports `prisma` so tests can `import` it for arrange/assert.

### MSW

- `tests/mocks/server.ts` — assembles `setupServer` from the handler list.
- `tests/mocks/handlers.ts` — one handler ships out-of-the-box: Resend's `POST /emails` (captures rendered email to `tests/fixtures/email/<recipient>.json` for assertion).
- `tests/mocks/utils.ts` — fixture I/O (`readFixture`/`createFixture`), Zod-validated `EmailSchema`, and `requireEmail(recipient)` helper for post-action assertions.

Add new handlers in `handlers.ts` whenever the app gains a third-party integration.

### Factories

`tests/factories/index.ts` exports:

- **Builders** (`buildTenant`, `buildUser`, `buildRole`) — pure object builders; spread into `prisma.X.create({ data: ... })`. A shared monotonic counter ensures uniqueness across a suite.
- **`seedActiveUserStatus(prisma)`** — idempotent upsert for the `ACTIVE` UserStatus row the app expects (matches seed baseline).
- **`seedFullScenario(prisma)`** — creates a tenant + active user + role + UserRole link in one call. The common arrange step for most integration tests.

Intentionally thin — no `@faker-js/faker`. Apps needing richer test data install it themselves.

### E2E harness

- Playwright spawns `npm run dev` on `PORT=3001` with `DATABASE_URL` pointing at `db-test`. `reuseExistingServer` keeps the dev server around across runs locally.
- `tests/e2e/global-setup.ts` — runs once before the suite: `prisma db push --accept-data-loss` + `npx tsx prisma/seed.ts` against the test DB.
- Two projects: `chromium` (default, runs everything except `smoke.spec.ts`) and `smoke` (only `smoke.spec.ts`). Smoke runs against a bare-boot app to verify the harness itself.
- Artifacts land in `tests/test-results/` (traces, screenshots) and `tests/playwright-report/` (HTML report).

### Running the test DB

The template's `docker-compose.yml` already defines a `db-test` service on port 5433 (tmpfs-backed so restarts are clean). Bring it up via:

```
docker compose up -d db-test
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/app_test" npx prisma db push --accept-data-loss
```

Integration and E2E tests connect via the `DATABASE_TEST_URL` env (defaults to the above URL when unset).

### Example tests

Shipped as harness exercises, not production coverage:

- `tests/unit/example.test.ts` — factory sanity check.
- `tests/integration/example.test.ts` — tenant round-trip + unique-slug constraint.
- `tests/e2e/smoke.spec.ts` — `/login` renders (smoke project).

Delete or replace these once you start writing real tests.

### Deviations

- **No `@faker-js/faker` dependency.** The monotonic `unique()` counter is enough for most seeding. Apps that need realistic names/emails/addresses add faker themselves.
- **No `@testing-library/react`.** Template doesn't ship component-unit tests because React Router's loader/action split means you test loaders server-side (integration) and behavior in the browser (E2E). Apps adopting DOM-heavy components should add testing-library + happy-dom.
- **MSW is Node-only** (`msw/node`). Browser MSW (`msw/browser`) for dev-mode stubs is out of scope — apps wire their own service-worker MSW if they want it.
- **Integration tests serialize** (`fileParallelism: false`). TRUNCATE CASCADE in `beforeEach` means parallel files would clobber each other. Faster alternative: wrap each test in a Prisma transaction and roll back — not shipped because the `TRUNCATE` flow is simpler and the test DB is tmpfs-cheap.
- **E2E uses a single worker** (`workers: 1`). Same rationale — shared DB. For true parallel E2E, apps either seed per-test data with unique suffixes or run multiple `db-test` instances.
- **`db-test` runs Postgres on tmpfs** (fast truncation, disposable state). Reseeding on every run takes ≤ 1 s; the tradeoff is that test data doesn't persist between runs (which is exactly what you want).
- **Playwright smoke project matches `smoke.spec.ts` only** and ignores it from the chromium project. Two commands: `npx playwright test --project=chromium` (default) and `npx playwright test --project=smoke` (boot validation). Useful for CI preflight.
- **No `test:unit:<subsystem>` convenience aliases shipped** — domain-specific splits are a fork concern. Apps add their own when their test count warrants it.
- **`tests/fixtures/` is gitignored by default** (match pattern `tests/fixtures/email/`) — consider whether your fixtures are canonical or transient before committing them.
- **No CI configuration shipped.** Apps wire their own GitHub Actions / GitLab CI; the `reporter: "github"` branch in `playwright.config.ts` adapts output automatically when `CI=true`.

## Server hardening (Phase 13)

Phase 13 adds the operational plumbing every production deploy needs: structured logs, correlation IDs, rate limiting, Sentry, and a shutdown-hook registry. It also completes the logger sweep — every `console.info/warn/error/debug` in server-only code from phases 6–12 was replaced with `logger.info/warn/error/debug`.

### Logger

`~/utils/monitoring/logger.server.ts` — pino instance used throughout the app code (services, loaders, actions, utilities). Pretty-prints in development, structured JSON in production, with a redaction list covering auth headers / secrets / session ids. Shape:

```ts
import { logger } from "~/utils/monitoring/logger.server";
logger.info({ userId, tenantId }, "user signed in");
logger.error({ err, ctx }, "something broke");
```

`server/logger.js` — parallel JS copy used by the Express boot file (can't share modules with the Vite-bundled app/ tree). Same config.

Env knobs: `LOG_LEVEL` (defaults `info`), `APP_NAME`, `APP_VERSION`, `NODE_ENV`.

### Correlation IDs

`server/correlation.js` + `app/middleware/correlation.server.ts` — an `AsyncLocalStorage<RequestContext>` shared across both sides of the server. Middleware reads upstream `x-correlation-id` / `x-request-id` (from load balancers, gateways) or mints a UUIDv4. Every response carries `x-correlation-id` so clients can pivot.

From inside a loader / action / service, use `getRequestLogger()` to get a correlation-bound child logger:

```ts
import { getRequestLogger } from "~/middleware/correlation.server";
const log = getRequestLogger();
log.info({ action: "create" }, "creating record"); // automatically tagged with correlationId
```

### Request logger

`server/request-logger.js` — logs `incoming request` on arrival and `request completed` on finish, with method, URL, status code, duration, and correlation ID. Skips Vite/HMR assets, favicons, service worker, SSE long-polls, and icon paths so the log stays focused on user-driven requests.

Log level auto-scales to request status: `info` for 2xx/3xx, `warn` for 4xx, `error` for 5xx.

### CORS

`server/security.ts` ships a `corsMiddleware` configured from `CORS_ORIGINS` (comma-separated, defaults to `http://localhost:3000`). Allows the custom headers the app uses: `X-CSRF-Token`, `X-API-Key`, `If-Match`, `Idempotency-Key`, `X-Correlation-Id`, `X-Request-Id`. Credentials mode is on so cookie auth traverses subdomains.

### Rate limiting

Three pre-configured limiters in `server/security.ts`:

| Name              | Window | Limit | Scope                      | Mounted                                                 |
| ----------------- | ------ | ----- | -------------------------- | ------------------------------------------------------- |
| `generalLimiter`  | 15 min | 300   | Every request              | Globally via `app.use(generalLimiter)` in server/app.ts |
| `mutationLimiter` | 1 min  | 50    | POST/PUT/PATCH/DELETE only | Not mounted — apps mount where needed                   |
| `authLimiter`     | 1 min  | 10    | Every request              | Not mounted — apps mount on `/login`, `/signup`, etc.   |

Limits are keyed per-user when authenticated (via `extractSessionUser`), per-IP otherwise. Health checks (`/up`, `/healthz`) are skipped. Override `generalLimiter` via `RATE_LIMIT_WINDOW_MS` + `RATE_LIMIT_MAX_REQUESTS` env vars.

### Rate-limit audit

`server/rate-limit-audit.ts` — every 429 appends to an in-process buffer that flushes every 5 s or at 50 entries, writing a `RATE_LIMIT` row to `AuditLog` (entity type `RateLimit`, entity id = tier name). Keeps the audit trail without hammering the DB under sustained abuse. The flush timer uses `.unref()` so it doesn't hold the event loop open at shutdown, and the shutdown hook (see below) does one last flush.

### Sentry

- `~/utils/monitoring/sentry.server.ts` — `@sentry/node` wrapper with `captureException(error, context?)`, `captureMessage`, `setUser`. No-ops when `SENTRY_DSN` is unset, so callers never need to gate.
- `~/utils/monitoring/sentry.client.ts` — `@sentry/browser` wrapper plus `initSentryClient(dsn)` that's safe to call repeatedly. `root.tsx` invokes it in an effect with the DSN pulled from `window.ENV.SENTRY_DSN` (exposed via `getEnv()`).
- `server/sentry.js` — boot-time init for the Express process. **Must** be imported at the very top of `server/app.ts` because `@sentry/node` patches global `http` / `fetch` on `init()` — anything that uses those before init happens won't be instrumented.

Context propagation: pass `{ correlationId, tenantId, userId }` to `captureException` and they become tags (correlationId, tenantId) and user (userId); everything else goes into extras.

### Graceful shutdown

`server/shutdown.js` — small hook registry. Any subsystem that needs cleanup registers itself:

```ts
import { onShutdown } from "./shutdown.js";
onShutdown(() => redis.quit());
onShutdown(async () => await queueDrainer.drain());
```

A single `SIGTERM` / `SIGINT` handler in `server/app.ts` runs every hook in registration order, awaits async ones, swallows individual failures, and exits cleanly. Phase 13 registers two hooks by default: `flushRateLimitBuffer` (persist any unwritten violations) + `stopJobProcessor` (stop claiming new queue jobs).

### Env additions

`env.server.ts` gained these optional vars (boot succeeds without them):

- `APP_NAME`, `APP_VERSION` — logger + Sentry `service` / `release` tags.
- `LOG_LEVEL` — pino level (`fatal` | `error` | `warn` | `info` | `debug` | `trace`).
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` — Sentry (both sides).
- `CORS_ORIGINS` — comma-separated allowlist.
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` — override general limiter.

`getEnv()` now also surfaces `SENTRY_DSN` so the client Sentry init can read it from `window.ENV`.

### Logger sweep (cross-phase cleanup)

Every `console.info/warn/error/debug` in server-only files from phases 6–12 got rewritten to `logger.*`. 8 files touched:

- `app/services/sso.server.ts`, `app/services/webhook-delivery.server.ts`, `app/services/webhook-dispatcher.server.ts`
- `app/utils/auth/audit.server.ts`, `app/utils/auth/sso-state.server.ts`
- `app/utils/events/job-handlers.server.ts`, `app/utils/events/job-queue.server.ts`, `app/utils/events/webhook-emitter.server.ts`

Each gained `import { logger } from "~/utils/monitoring/logger.server";` and had the `console.*` calls replaced. Pino accepts both string-only (`logger.info("msg")`) and object-first (`logger.info({ ctx }, "msg")`) signatures, so the mechanical sweep didn't require call-site rewrites.

Files outside `app/` (namely `public/sw.js` and `tests/**`) were deliberately NOT touched — the service worker runs outside the bundler and tests should stay self-contained.

### Deviations

- **Migration baseline skipped.** The memory file has long noted Phase 13 "should" add a Prisma migration baseline to replace the `db push` workflow. Out-of-scope for this phase — it'd require re-running every existing `db push` as a migration dev command, regenerating migration files, and re-validating. Saved for a dedicated phase. Template continues to ship with `db push` (see Phase 6a note).
- **No helmet wiring.** Template ships `@nichtsam/helmet` as a dep but `server/app.ts` doesn't apply it. A production-grade CSP needs app-specific decisions about `unsafe-inline`, worker-src, blob:, and the nonce provider plumbing — deferred to the fork. Apps add their own helmet block in `server/app.ts` between CORS and the rate limiter when they're ready to lock down CSP.
- **No suspicious-request blocker.** A middleware that 403s requests with missing user-agent/accept or matching sqlmap/nikto/traversal patterns is aggressive and false-positive-prone in dev, so the template leaves it out. Apps that want it add the middleware in `server/security.ts` and wire it before the rate limiter.
- **No `/healthz` / `/up` route.** `skipHealthCheck` in the rate limiter handles both paths, but no actual route is mounted. Apps add one (typically `app.get("/up", (_req, res) => res.status(200).send("ok"))`) in their `server/app.ts` before the React Router handler.
- **Sentry replay not wired.** The client init references `replaysSessionSampleRate` / `replaysOnErrorSampleRate` but the template doesn't install `@sentry/browser`'s replay integration. Apps opting in add `Replay` to the `integrations` array.
- **`mutationLimiter` and `authLimiter` are not mounted.** They're exported from `server/security.ts`. Apps mount `mutationLimiter` on `/api` after the API-key check, and `authLimiter` on the pre-auth routes.
- **Rate-limit buffer is in-process.** Not Redis-backed. A multi-process deploy loses the cross-process view of violations unless apps swap in a Redis store (`rate-limit-redis`) on the limiters.
- **Request-logger skiplist is hand-curated.** Apps adding new high-traffic endpoints (health-check pollers, internal SSE) should add patterns to `request-logger.js` to keep log volume sane.
- **`trust proxy` is hardcoded to `1`.** Matches a single reverse proxy in front (Render / Fly / Nginx). Multi-hop deployments bump this, same-host deploys set it to `false`.
- **`public/sw.js` keeps `console.*`** — it runs outside the bundler (no `logger` available). Logs still land in browser DevTools; pipe them to Sentry via the client SDK if needed.
- **Suspicious-request blocker, nonce middleware, permissions-policy header, and a hardened helmet CSP are intentionally NOT shipped** — all valid hardening, but the template leaves CSP/security-header ergonomics to the fork so apps can pick the trade-offs (nonce-vs-hash, `unsafe-inline`, blob:/worker-src) that match their runtime.
- **No `/api` mutation limiter.** The api-key middleware gates `/api/*`, but an application-level rate limit for mutation-heavy API calls is an app concern.

## Demo entity — Notes (Phase 14)

Phase 14 ships the Notes module — the template's "living documentation." It exists to exercise every pattern the template teaches, so forks have a working reference to copy from.

### What it demonstrates

| Pattern                          | Where                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Shared-editor upsert             | `notes/+shared/note-editor.tsx` + `.server.tsx`, schema `id` optional                                            |
| Async `superRefine` domain check | `note-editor.server.tsx` — category must belong to tenant                                                        |
| Dot-delimited detail layout      | `$noteId._layout.tsx` with 2/3 + 1/3 grid                                                                        |
| Trailing-underscore escape       | `$noteId_/edit.tsx` — full-page editor outside the detail layout                                                 |
| Dialog overlay route             | `$noteId.delete.tsx`, `$noteId.comments.new.tsx`, `$noteId.comments.$commentId.delete.tsx`                       |
| Nested sub-entity CRUD           | NoteComment — list inside detail, add + delete via dialogs                                                       |
| DataTable with filters           | `index.tsx` — search, status filter, category filter, pagination                                                 |
| Soft delete                      | `Note.deletedAt`, `NoteCategory.deletedAt`, `NoteComment.deletedAt` — every list query filters `deletedAt: null` |
| Versioning                       | `Note.version` bumped on update                                                                                  |
| Feature-flag gating              | `FF_NOTES` (tenant-scoped, default on) — tenant nav link + every loader/action calls `requireFeature`            |
| Tenant scoping                   | Every service call takes a `tenantId`; the service filters on it                                                 |
| Per-operation RBAC               | `requirePermission("note", "write"                                                                               | "delete")` on mutation routes |
| i18n namespace                   | `notes` namespace (en + fr) with pluralization via `commentsCount_one/_other`                                    |

### Schema

- `NoteStatus` enum: `DRAFT` | `PUBLISHED` | `ARCHIVED`.
- `Note` — `title`, `content` (Text), `status`, `categoryId?` → `NoteCategory`, `tags` (`String[]`), `dueDate?`, `authorId` → `User`, `version`, `metadata` (Json), soft delete.
- `NoteCategory` — self-referential (`parentId` → `NoteCategory`) with cycle guard in the service, soft delete, unique-per-tenant `(tenantId, name)`.
- `NoteComment` — belongs to `Note`, soft delete.
- Back-relations on `Tenant` (`notes`, `noteCategories`) and `User` (`notesAuthored`, `noteComments`).

Schema pushed via `db push --accept-data-loss` (template workflow).

### Service

`~/services/notes.server.ts` (~300 lines):

- `listNotes(tenantId, { where, page, pageSize, orderBy })` — search on title/content, filter on status/category, include author + category + comment count. Returns `{ data, total }`.
- `getNote(id, tenantId)` — includes full comment list (each with author) plus category + author + comment count.
- `createNote` / `updateNote` — shared schema shape. Update increments `version`.
- `deleteNote` — soft delete (`deletedAt = now`). Apps hard-delete by calling `prisma.note.delete()` directly once they've confirmed retention policy.
- `addComment` / `deleteComment` — nested sub-entity CRUD; `deleteComment` is soft.
- `listCategories` / `getCategory` / `createCategory` / `updateCategory` / `deleteCategory` — with a cycle-detection pass on `updateCategory` that walks the parent chain up to depth 32 before rejecting.

### Routes

```
$tenant/notes/
  +shared/
    note-editor.tsx              — Form component (shared by new + edit)
    note-editor.server.tsx       — Upsert action (id present → update, absent → create)
  index.tsx                      — DataTable with search, status + category filters
  new.tsx                        — Thin wrapper: loader fetches categories, re-exports shared action
  $noteId._layout.tsx            — Detail layout (2/3 content + comments, 1/3 metadata) with <Outlet />
  $noteId.delete.tsx             — Dialog (inside layout, uses <Dialog>)
  $noteId.comments.new.tsx       — Dialog (add comment)
  $noteId.comments.$commentId.delete.tsx — Dialog (delete comment)
  $noteId_/
    edit.tsx                     — Standalone full-page edit form (escapes the layout)
```

### Permissions

`UNIQUE_PERMISSIONS` gained `note:{read,write,delete}` under module `content`. Admin role picks them up automatically on seed. The `requirePermission` helper enforces them on mutation routes; `requireFeature("FF_NOTES")` gates the whole surface.

### Feature flag

`FF_NOTES` — tenant-scoped, defaults to **enabled** (so the demo renders out-of-the-box). Apps that don't want Notes in their fork can flip it off in the feature-flags admin, delete the routes + service + schema entirely, or keep the code as a reference with the flag off.

### Navigation

Tenant top nav conditionally renders a "Notes" `NavLink` when `FF_NOTES` is on — resolved via the same `enabledFeatures` map that gates `NotificationBell` and `LanguageSwitcher`.

### Deviations

- **Content is not markdown-rendered.** The schema stores markdown text but the detail page renders it inside `<pre>` with `whitespace-pre-wrap`. Apps wire a markdown renderer (e.g. `react-markdown`) in `$noteId._layout.tsx` when they need it.
- **Tags are `String[]` on Postgres.** Works for small tag counts. For tag management (rename across all notes, tag browser), add a `Tag` model later with a join table.
- **Custom fields NOT wired.** Phase 7 shipped the `CustomFieldDefinition` model but the Notes service doesn't render/persist note-specific custom field values. Adding it means (a) a join table mapping `noteId` → `definitionId` → value, (b) dynamic form fields in the editor. Left out as an exercise.
- **Saved views NOT wired.** Phase 7b shipped `ViewSwitcher` + `resolveViewContext`. The Notes list could be the template's first consumer — a natural follow-up. For now it's a plain DataTable with URL-param filters.
- **Kanban / Calendar / Gallery renderers NOT wired.** Status would be a good kanban lane field, `dueDate` a good calendar field — but the alternate view renderers are still stubs per Phase 5's deviations.
- **Category admin NOT shipped.** Service has full CRUD; no `/settings/notes/categories` UI. Apps wanting a category editor follow the reference-data admin pattern from Phase 8b.
- **Cycle detection on category parent is depth-capped at 32** — pathological trees deeper than that would silently pass the guard. Good enough for a demo; apps that allow deep hierarchies should swap in a recursive CTE walk.
- **Comments don't paginate.** The detail page loads every comment. Apps that expect high comment volume add pagination / virtualization.
- **Version is incrementing-only.** No history table, no diff view. Adding `NoteVersion` with snapshot-on-write is a follow-up for apps that need audit.
- **Seed data not shipped.** No sample notes so apps see a genuine empty-state first run. A three-note seed block is a one-line copy into `prisma/seed.ts` if a fork wants one.
- **No unit/integration/E2E tests shipped** for Notes. Phase 12 shipped the harness with example tests; adding real coverage for the demo entity is in-scope for apps that want it as ground truth.
- **Content editor is a plain `<Textarea>`.** No WYSIWYG, no slash commands, no /blocks. Intentional — this is the template pattern for a text field, not a content platform.
- **No draft autosave.** Apps wanting draft-as-you-type add fetcher-based persistence on blur or interval.
- **No "add category" inline.** The category SelectField shows existing categories only. Apps add a "+ new category" option that opens a side-drawer or navigates to a create flow.

## Directory + editorial workflow (Greenbook)

Greenbook's domain module — the AU Commission Blue Book. Unlike every other section on this page, this subsystem is **not** part of the template extraction; it's the first real product feature built on top of it. Fork-plan: `docs/plans/2026-04-21-organizations-people-directory.md` (v3 is authoritative).

### Shape

Four tenant-scoped entities with no cross-tenant references:

- **`Organization`** — hierarchical, self-referencing `parentId`, typed via `OrganizationType` (ROOT / MAIN_ORGAN / DEPARTMENT / OFFICE / UNIT).
- **`Person`** — individual record with `honorific`, contact fields, `memberStateId` (nationality), + `showEmail` / `showPhone` public-visibility toggles.
- **`Position`** — formal post inside an org, with a `reportsToId` self-reference for internal reporting chains.
- **`PositionAssignment`** — temporal link between a Person and a Position (`startDate`, `endDate`, `isCurrent`). Auto-closes the prior current assignment when a new one starts on the same position.

Supporting reference data: `RegionalGroup` (5 AU regions), `MemberState` (55 member states with region joins), `OrganizationType`, `PositionType`. Seeded into the system tenant by `seedDirectory(tenantId)` in `prisma/seed.ts`.

### Editorial workflow (ChangeRequest engine)

Every mutation flows through `app/services/directory-changes.server.ts`. The real entity tables hold only published state; proposed changes live as `ChangeRequest` rows with status `PENDING → APPROVED | REJECTED | WITHDRAWN`.

- **Focal persons** (role `focal`) hold `directory-change:submit`. Their edits `submitChange()` — the record doesn't change until a manager approves.
- **Managers** (role `manager`) hold `{organization,person,position,position-assignment}:write`. Their direct edits `submitAndApply()` — creates a self-approved ChangeRequest + applies in one transaction.
- **One PENDING per `(entityType, entityId)`** enforced in service (future partial unique DB index).
- **Approval runs in a single `$transaction`** — `_applyCreate/Update/Move/SoftDelete` writers each accept an optional `tx: Prisma.TransactionClient` so guards, writes, and the ChangeRequest update commit atomically.
- **Batch approve/reject** via `approveChanges(ids, ...)` / `rejectChanges(ids, ...)` — per-id atomic loop, capped at `MAX_BATCH_SIZE = 100`. NOT_FOUND / NOT_PENDING become `skipped` in the `BatchResult` rather than `failed`.
- **Domain events** — entity-level events (`organization.created`, etc.) fire **only on approval**; a parallel event stream (`change.submitted`, `change.approved`, `change.rejected`, `change.withdrawn`) drives workflow consumers. Catalog in `app/utils/events/webhook-events.ts`.

### Cross-tenant public tier (Phase D — shipped)

- Admin is tenant-scoped; the public surface is a single cross-tenant unified directory at `/directory/*` (no tenant slug). Visitors never see the word "tenant." (Slugs `directory` and `public` are both reserved in `app/utils/schemas/tenant.ts` so no tenant can collide.)
- `app/services/public-directory.server.ts#getPublicTenantIds()` — 5-min-cached gate that returns tenant ids where `FF_PUBLIC_DIRECTORY` is on.
- `public*` helpers on each entity service (`publicListOrganizationTreeRoots`, `publicListOrganizationChildren`, `publicGetOrganization`, `publicListPeople`, `publicGetPerson`, `publicGetPosition`) accept the opted-in tenant set as an argument and **never include `tenantId`** in their response shape. An integration test asserts this invariant per helper.
- PII strip for `Person`: `email` / `phone` are returned only when `showEmail` / `showPhone` is true. Same strip applied in list + detail.
- Shared utility: `app/utils/public-directory.server.ts` exports `getPublicContext()` (one-call gate), `PUBLIC_CACHE_HEADER` (`public, max-age=60, stale-while-revalidate=300`), `publicCacheHeaders()`, and `publicOrgToTreeNode()` (reshapes `PublicOrgNode` into the include-shape the admin tree wrappers expect, so the public tree reuses `OrganizationHierarchyTree` with `canMove={false}`).
- Public loaders **never** call `requireSession` / `resolveTenant`. Every loader exports a `headers()` returning `Cache-Control: PUBLIC_CACHE_HEADER`. The lazy-load API route uses a shorter TTL (`max-age=30, stale-while-revalidate=120`).
- `public/robots.txt` allows `/directory/*` and disallows auth paths.
- Detail-page 404s throw a `Response(status: 404)` with the cache header set; each detail route's `ErrorBoundary` renders the shared `~/components/public/not-found.tsx#PublicDetailNotFound` with `kind` in `"org" | "person" | "position"`.
- Public routes (`app/routes/directory/*`): `_layout` (AU chrome + language switcher + nav), `index` (hero + featured principal organs), `organizations/index` (read-only tree), `organizations/$orgId` (detail), `people/index` (search + pagination), `people/$personId` (detail with `AssignmentTimeline` over the person's full history), `positions/$positionId` (current holder + timeline), `api/organizations.children` (lazy-load children, no auth). Static-segment precedence means `/directory/*` wins over `/:tenant/*` at the auto-routes level.

### Phase E additions

Post-MVP polish that landed alongside the public tier:

- **Notifications on workflow transitions** (`app/services/directory-notifications.server.ts`). `submitChange` notifies every user in the tenant with `directory-change:approve` (except the submitter — dual-role users don't get pinged for their own submissions). `approveChange` / `rejectChange` notify the submitter with the reviewer's name + reject notes when present. All fire-and-forget: failures are logged, never unwind the approval transaction. Skip when reviewer = submitter (self-approved manager path).
- **Reference-id hydration in diffs** (`computeDiff` in `directory-changes.server.ts`). Per-field cuid references — `parentId`, `typeId`, `organizationId`, `reportsToId`, `memberStateId`, `personId`, `positionId` — resolve to human-readable names in the approval UI. Uses `REFERENCE_FIELDS` + `resolverFor` tables per `DirectoryEntityKey`; each resolver runs a single `findMany` across all referenced ids.
- **`AssignmentTimeline` on public pages.** `publicGetPerson` now returns `history: PublicPersonTimelineEntry[]` (capped at 50, same ceiling as `publicGetOrganization.positions`). The public person + position detail pages drop the hand-rolled list renderer and render `AssignmentTimeline` with `mode="byPerson"` / `"byPosition"`.
- **i18n'd tree toolbar.** `HierarchyTree` accepts a `labels` prop with `expandAll / collapseAll / moving / placeholder / resultCount`. `OrganizationHierarchyTree` threads it through; both the admin (`directory` namespace) and public (`directory-public` namespace) routes pass locale-bound values.
- **Seed fix.** `FF_DIRECTORY` is now opted into the system tenant in the same post-DEFAULT_FLAGS block as `FF_PUBLIC_DIRECTORY`. Tenant-scoped flags ignore the `enabled` boolean — membership in `enabledForTenants` is the actual gate — so the previous shape blocked every demo user from the admin surface.

### Routes (admin, `app/routes/$tenant/directory/`)

```
_layout.tsx                                       — NavTabs (Overview / Orgs / People / Positions / Approvals | Mine)
index.tsx                                         — KPI overview
organizations/
  index.tsx, new.tsx, $orgId._layout.tsx,
  $orgId_/edit.tsx, $orgId.delete.tsx,
  +shared/organization-editor.{tsx,server.tsx}
people/
  index.tsx, new.tsx, $personId._layout.tsx,
  $personId_/edit.tsx, $personId.delete.tsx,
  +shared/person-editor.{tsx,server.tsx}
positions/
  index.tsx, new.tsx, $positionId._layout.tsx,
  $positionId_/edit.tsx, $positionId.delete.tsx,
  $positionId.assign.tsx (dialog),
  $positionId.assignments.$assignmentId.end.tsx (dialog),
  +shared/position-editor.{tsx,server.tsx}
changes/
  _layout.tsx (NavTabs: Pending / Mine / History)
  index.tsx (pending queue; selectable + batch dialog for reject notes)
  mine.tsx, history.tsx
  $changeId._layout.tsx (diff + metadata + action buttons)
  $changeId.approve.tsx, .reject.tsx, .withdraw.tsx (dialogs)
  batch-approve.tsx, batch-reject.tsx (resource routes)
```

### Key helpers

| Helper                                                                | File                                               | Purpose                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `requireDirectoryAccess(request, { write? })`                         | `app/utils/directory-access.server.ts`             | Resolves `{ user, tenantId, canDirect, canSubmit, canReview }` in one call                                                |
| `requireDirectoryWriteAccess(request, resource)`                      | same                                               | Gates new/edit/delete loaders — fails 403 if neither direct-write nor submit                                              |
| `requireReviewContext(request)` / `requireSubmitContext(request)`     | same                                               | Collapses `requireDirectoryAccess + buildServiceContext` for approval/submission routes                                   |
| `dispatchDirectoryChange(request, resource, input)`                   | `app/utils/directory-submit.server.ts`             | Editor actions call this; routes through `submitAndApply` (manager) or `submitChange` (focal person) based on permissions |
| `dispatchDirectoryDelete(request, resource, entityType, id, reason?)` | same                                               | Convenience wrapper for DELETE dialogs                                                                                    |
| `directoryEntitySegment(entity)`                                      | `app/utils/directory-routes.ts`                    | Maps `DirectoryEntity` enum to admin URL segment (for deep-links from the change-detail page)                             |
| `formatBatchSummary(result, verb)`                                    | `app/services/directory-changes.server.ts`         | Produces "5 approved · 1 skipped" strings for the fetcher responses                                                       |
| `NavTabs`                                                             | `app/components/layout/nav-tabs.tsx`               | Shared horizontal tab strip, used by Directory `_layout.tsx` + Changes `_layout.tsx`                                      |
| `PendingBadge`                                                        | `app/components/directory/pending-badge.tsx`       | Amber pill shown on entity detail pages when a pending change exists                                                      |
| `ChangeStatusPill`                                                    | `app/components/directory/change-status-pill.tsx`  | Status badge across queue + detail                                                                                        |
| `ChangeDiff`                                                          | `app/components/directory/change-diff.tsx`         | Renders `FieldDiff[]` from `computeDiff()` as field / before / after                                                      |
| `AssignmentTimeline`                                                  | `app/components/directory/assignment-timeline.tsx` | Vertical timeline of assignments; used on Person + Position detail pages                                                  |

### Form schemas

`app/utils/schemas/directory.ts` separates two schema families:

- **Payload schemas** (`organizationPayloadSchema`, `personPayloadSchema`, etc.) — applied by the change-request engine's `validatePayload`. Include transforms (`nullableString`, `nullableCuid`, `isoDate`) that normalise `""` → `null` etc.
- **Form schemas** (`organizationFormSchema`, `personFormSchema`, `positionFormSchema`, `assignPersonFormSchema`, `endAssignmentFormSchema`) — consumed by the shared editor components. Deliberately **no transforms** to avoid Conform re-submit edge cases; transforms happen at the engine's `validatePayload` boundary.

### Permissions + roles

Under module `directory`:

- `organization:{read,write,delete}` / `person:*` / `position:*` / `position-assignment:*`
- `directory-change:submit` / `:withdraw-own` / `:read-own` / `:read-all` / `:approve` / `:reject`

Seeded roles per tenant (in `prisma/seed.ts`):

- `focal` — reads + `directory-change:{submit, withdraw-own, read-own}`
- `manager` — everything `focal` has + entity writes + `directory-change:{read-all, approve, reject}`
- `admin` (existing) — picks up every permission via the seed's "all permissions" assignment

Demo users: `focal@example.com / focal123`, `manager@example.com / manager123`.

### Feature flags

- `FF_DIRECTORY` — gates the `/$tenant/directory/*` admin surface (default on for system tenant).
- `FF_PUBLIC_DIRECTORY` — **opts the tenant into the unified public directory** (default on for system tenant). Public helpers aggregate across opted-in tenants via `getPublicTenantIds()`.

### Deviations + open issues

- **E2E smoke test skipped** — `tests/e2e/directory-flow.spec.ts` contains a working skeleton of the focal → manager → public round trip but is `test.skip`'d: the dev-mode SSR server's first-render latency pushes the three sequential page loads past Playwright's per-test budget. Fix requires running against `npm run build && npm run start` or splitting into three smaller tests with shared fixtures — deferred to Phase F.
- **CSV bulk import** — deferred to Phase F.
- **Migration baseline** — still on `db push` like the rest of the template. Apps generate migrations when they lock down for prod.
- **Assignment timeline pagination** — `publicGetPerson.history` capped at 50 (matches `publicGetOrganization.positions`). A person with >50 recorded posts needs a dedicated timeline pagination route.
- **Tree lazy-load bypasses HTTP cache** — each tree expand is a POST FormData, so `Cache-Control` headers don't apply. The in-component `loadedChildrenRef` prevents duplicate queries within one session; across visitors each expand hits the DB. Fix would require switching the child fetcher to GET with query params.
- **Tree DnD rollback on backend failure** — optimistic cache update is not reverted when `/api/organizations/move` returns `{ ok: false }`. User sees an error toast and can re-drag.
- **No `@faker-js/faker` seed data for people** — seed ships starter orgs + types + regions + member states, but not sample people/positions. Populate via the UI.
- **Public notification + submission chrome missing** — notifications fire but the bell/inbox UI only lives on tenant layouts. Public visitors get nothing (intentional — they're unauthenticated).

## Docs polish (Phase 15)

Phase 15 is the final phase — it's docs-only, closes out the extraction plan, and brings the template's front-door documentation in line with everything that landed across phases 0–14.

### Changes

- **`README.md` rewrite.** The Phase 0 README described only the base React Router scaffold; phases 1–14 added ~13 subsystems that weren't mentioned. The new README leads with a "What you get, out of the box" inventory (auth, multi-tenancy, SSO, privacy, PWA, etc.), a setup block that reflects the current docker-compose + seed flow, a project-layout tree covering all app/ subdirectories, the full command list, a feature-flag reference table with defaults, an env-var reference pointing to `.env.example`, and deployment notes.
- **`.env.example` completeness pass.** Added the optional operational vars that landed in phases 10 (`APP_URL`), 13 (`APP_NAME`, `APP_VERSION`, `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `CORS_ORIGINS`). Grouped as "Required" / "Optional" with inline comments.
- **`CLAUDE.md` intro refresh.** The "Template Scope" paragraph previously said "Future phases will add RBAC, multi-tenancy…" — stale after 14 phases shipped. Rewrote to reflect today's reality. Added a "Patterns by phase" jump table so new readers can find subsystem docs without scrolling the ~1000-line file. Replaced the "Patterns — coming in later phases" list (every bullet had shipped) with a "Core patterns reference" task-based quick index. Fixed the `db:migrate` / "when a seed script lands" placeholders in the database-commands block. Fleshed out the `app/utils/` subdirectory list (covers all phases, not just Phase 0's four folders). Expanded the "Stack" bullet list to include events/jobs, observability, i18n, PWA, testing.

### Deviations

- **No migration baseline added.** Still on `db push` — see the Phase 13 deviations for the rationale. A dedicated migrations phase belongs on the post-extraction backlog.
- **No CONTRIBUTING.md, no CHANGELOG.md, no issue templates.** This is an opinionated template meant to be forked, not a shared library accepting external contributions. Apps that want those files add them on fork.
- **No LICENSE file shipped.** The README mentions MIT-style terms but the actual LICENSE file isn't in the repo. First-time forks should add their chosen license immediately.
- **No architecture diagram.** The phases-by-table and per-phase sections substitute for one; apps that want box-and-arrow visuals generate their own (mermaid works in the markdown).
- **No upgrade / migration guide for apps already forked mid-extraction.** The template landed in one go across 14 phases — there's no sequence of "bump to phase N then N+1" instructions because everything merged to `main`. Forks from before a given phase pull the missing commits in one go.
- **`docs/superpowers/specs/2026-04-20-template-extraction-design.md`** is the original plan doc; kept for historical context but not cross-linked from every section. The per-phase sections in this file are the current source of truth.
