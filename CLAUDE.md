# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this template.

## Template Scope

This is a **living template** for building multi-tenant SaaS apps on React Router 7. It ships the domain-agnostic plumbing (auth, RBAC, multi-tenancy, settings, feature flags, i18n, events/jobs, SSO, privacy, PWA, observability, testing harness). Business domains go in forks.

The extraction plan that produced this template (`docs/superpowers/specs/2026-04-20-template-extraction-design.md`) landed in 15 phases, all merged. Per-subsystem deep dives live under `docs/template/phase-XX-*.md`. The "Patterns by phase" table below links to them — skim the "Deviations" block at the bottom of each phase file before starting new work.

## Patterns by phase

| Phase | Subsystem                                                     | Look here                                                                                                                                                                                                                                                   | Deep dive                                                                                |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1     | Auth + RBAC + audit log                                       | `app/utils/auth/`, `app/services/{users,roles,permissions,two-factor}.server.ts`                                                                                                                                                                            | —                                                                                        |
| 2     | Multi-tenancy + invitations                                   | `app/routes/$tenant/_layout.tsx`, `app/services/{tenants,invitations,tenant-setup}.server.ts`, `app/utils/request-context.server.ts`                                                                                                                        | —                                                                                        |
| 3     | Settings + feature flags + business hours                     | `app/services/{settings,business-hours}.server.ts`, `app/utils/config/{settings,feature-flags}.server.ts`                                                                                                                                                   | —                                                                                        |
| 4     | i18n                                                          | `app/utils/i18n.ts`, `app/locales/`, `app/utils/i18n-cookie.server.ts`                                                                                                                                                                                      | See "i18n" below                                                                         |
| 5     | Components library                                            | `app/components/form.tsx`, `app/components/data-table/`, `app/hooks/use-cascade.ts`                                                                                                                                                                         | [docs/template/phase-05-components.md](docs/template/phase-05-components.md)             |
| 6     | Events + jobs + webhooks + SSE + notifications                | `app/utils/events/`, `app/services/{webhooks,webhook-dispatcher,webhook-delivery,notifications}.server.ts`, `server/sse.ts`                                                                                                                                 | [docs/template/phase-06-events-jobs.md](docs/template/phase-06-events-jobs.md)           |
| 7     | Saved views + custom fields + search + export                 | `app/services/{saved-views,custom-fields,search,data-export,view-filters}.server.ts`                                                                                                                                                                        | [docs/template/phase-07-data-patterns.md](docs/template/phase-07-data-patterns.md)       |
| 8     | Reference data (Country/Title/Language/Currency)              | `app/services/reference-data.server.ts`, `app/routes/$tenant/settings/references/`                                                                                                                                                                          | [docs/template/phase-08-reference-data.md](docs/template/phase-08-reference-data.md)     |
| 9     | Privacy (DSAR + consent) + audit-log UI                       | `app/services/privacy.server.ts`, `app/routes/$tenant/settings/privacy/`, `app/routes/$tenant/logs/`                                                                                                                                                        | [docs/template/phase-09-privacy-audit.md](docs/template/phase-09-privacy-audit.md)       |
| 10    | SSO (OIDC + SAML)                                             | `app/services/sso.server.ts`, `app/utils/auth/{oidc,saml,sso-state}.server.ts`, `app/routes/_auth/sso/`, `app/routes/$tenant/settings/sso/`                                                                                                                 | [docs/template/phase-10-sso.md](docs/template/phase-10-sso.md)                           |
| 11    | PWA + offline                                                 | `public/sw.js`, `public/manifest.json`, `app/utils/offline/`, `app/components/{offline-banner,pwa/*}.tsx`                                                                                                                                                   | [docs/template/phase-11-pwa.md](docs/template/phase-11-pwa.md)                           |
| 12    | Testing harness                                               | `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `tests/`                                                                                                                                                                        | [docs/template/phase-12-testing.md](docs/template/phase-12-testing.md)                   |
| 13    | Observability (logger/correlation/rate limit/Sentry/shutdown) | `app/utils/monitoring/`, `app/middleware/correlation.server.ts`, `server/{logger,correlation,request-logger,security,rate-limit-audit,sentry,shutdown}.{js,ts}`                                                                                             | [docs/template/phase-13-server-hardening.md](docs/template/phase-13-server-hardening.md) |
| 15    | Docs polish                                                   | `README.md`, `.env.example`                                                                                                                                                                                                                                 | [docs/template/phase-15-docs-polish.md](docs/template/phase-15-docs-polish.md)           |
| app   | Directory (Greenbook domain — AU Blue Book)                   | `app/services/{organizations,people,positions,position-assignments,directory-changes,public-directory}.server.ts`, `app/routes/$tenant/directory/`, `app/utils/{directory-access,directory-submit,directory-routes}.server.ts`, `app/components/directory/` | See "Directory + editorial workflow" below                                               |

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

See `docs/template/phase-12-testing.md` for setup file layout, runner tiers, MSW handler registration, and factory usage.

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

- `app/routes/` — File-based routing via `react-router-auto-routes`. Folders prefixed with `+` are ignored by auto-routes (colocates shared editor components next to their routes).
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
  - `app/utils/schemas/` — cross-cutting Zod schemas (privacy, sso, directory, tenant)
  - `app/utils/constants/` — enum key lists + color maps for status badges
- `app/middleware/` — request-scoped helpers (correlation ID + AsyncLocalStorage)
- `app/services/` — business logic (one file per domain, `.server.ts`)
- `app/locales/` — i18n JSON (en/ + fr/), one file per namespace, registered in `utils/i18n.ts`
- `app/hooks/` — client hooks (`use-base-prefix`, `use-cascade`, `use-sse`, `use-online-status`)
- `server/` — Express app boot + middleware (logger, correlation, rate limit, Sentry, shutdown).
- `public/` — static assets (`sw.js`, `manifest.json`, icons).
- `prisma/schema.prisma` — Database schema.
- `prisma.config.ts` — Prisma 7 configuration file (datasource URL lives here, not in schema).
- `tests/` — `unit/`, `integration/`, `e2e/`, and `setup/`.
- `docs/template/` — Per-phase deep dives (shape, conventions, deviations).

Path alias: `~/*` maps to `./app/*`.

## Code Conventions

- **Formatting:** Prettier — double quotes, semicolons, trailing commas, 100-char width, 2-space indent.
- **Commits:** Conventional Commits enforced by commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`. Max subject 100 chars.
- **Pre-commit:** Husky + lint-staged runs Prettier on staged files. Git `core.hooksPath` points to `react-router/.husky`.
- **Server-only code:** `.server.ts` suffix — excluded from client bundles by React Router.
- **Node version:** 22 (leverages native TypeScript support via type stripping).

## Core patterns reference

Task-based quick index for common work:

| Task                                | Canonical example                                                            | Docs                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| Wire a form                         | `app/routes/$tenant/directory/organizations/+shared/organization-editor.tsx` | `docs/template/phase-05-components.md`       |
| Dialog overlay on a detail page     | `app/routes/$tenant/directory/organizations/$orgId.delete.tsx`               | "Directory" section below                    |
| Trailing-underscore escape          | `app/routes/$tenant/directory/organizations/$orgId_/edit.tsx`                | "Directory" section below                    |
| Cascading selects                   | `app/hooks/use-cascade.ts` + existing consumers                              | `docs/template/phase-05-components.md`       |
| Tenant-scoped list with filters     | `app/routes/$tenant/directory/organizations/index.tsx`                       | `docs/template/phase-07-data-patterns.md`    |
| Background job                      | `app/utils/events/job-handlers.server.ts`                                    | `docs/template/phase-06-events-jobs.md`      |
| Webhook emission                    | `app/services/webhooks.server.ts`                                            | `docs/template/phase-06-events-jobs.md`      |
| Gate by feature flag                | `requireFeature(request, "FF_NAME")`                                         | Phase 3 services in table above              |
| RBAC check                          | `requirePermission(request, "resource", "action")`                           | Phase 1 services in table above              |
| Structured logging with correlation | `getRequestLogger()` from `~/middleware/correlation.server`                  | `docs/template/phase-13-server-hardening.md` |

The per-phase docs under `docs/template/` each end with a "Deviations" block — skim these before starting new work, they flag the places where the template deliberately stopped short.

## When Helping Users Build Apps From This Template

- **Follow existing patterns** — the per-phase docs in `docs/template/` are the canonical shape of each subsystem.
- **Keep the `.server.ts` boundary clean** — never import `.server.ts` code from client-only modules.
- **Respect the `+` prefix** — folders like `app/routes/+shared/` are deliberately ignored by auto-routes.
- **Don't reintroduce `app/lib/`** — Phase 0 moved all utilities into `app/utils/` with domain subdirectories.

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

- **Notifications on workflow transitions** (`app/services/directory-notifications.server.ts`). `submitChange` notifies every user in the tenant with `directory-change:approve` (except the submitter). `approveChange` / `rejectChange` notify the submitter with the reviewer's name + reject notes when present. All fire-and-forget: failures are logged, never unwind the approval transaction. Skip when reviewer = submitter.
- **Reference-id hydration in diffs** (`computeDiff` in `directory-changes.server.ts`). Per-field cuid references — `parentId`, `typeId`, `organizationId`, `reportsToId`, `memberStateId`, `personId`, `positionId` — resolve to human-readable names in the approval UI. Uses `REFERENCE_FIELDS` + `resolverFor` tables per `DirectoryEntityKey`; each resolver runs a single `findMany` across all referenced ids.
- **`AssignmentTimeline` on public pages.** `publicGetPerson` now returns `history: PublicPersonTimelineEntry[]` (capped at 50, same ceiling as `publicGetOrganization.positions`). The public person + position detail pages drop the hand-rolled list renderer and render `AssignmentTimeline` with `mode="byPerson"` / `"byPosition"`.
- **i18n'd tree toolbar.** `HierarchyTree` accepts a `labels` prop with `expandAll / collapseAll / moving / placeholder / resultCount`. `OrganizationHierarchyTree` threads it through; both the admin (`directory` namespace) and public (`directory-public` namespace) routes pass locale-bound values.
- **Seed fix.** `FF_DIRECTORY` is now opted into the system tenant in the same post-DEFAULT_FLAGS block as `FF_PUBLIC_DIRECTORY`. Tenant-scoped flags ignore the `enabled` boolean — membership in `enabledForTenants` is the actual gate.

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
approvals/
  _layout.tsx (permission gate — tabs now live on the parent directory layout)
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

- **E2E smoke test skipped** — `tests/e2e/directory-flow.spec.ts` contains a working skeleton of the focal → manager → public round trip but is `test.skip`'d: dev-mode SSR latency pushes three sequential page loads past Playwright's per-test budget. Fix requires running against `npm run build && npm run start` or splitting into three smaller tests.
- **CSV bulk import** — deferred to Phase F.
- **Migration baseline** — still on `db push` like the rest of the template.
- **Assignment timeline pagination** — `publicGetPerson.history` capped at 50. A person with >50 recorded posts needs a dedicated timeline pagination route.
- **Tree lazy-load bypasses HTTP cache** — each tree expand is a POST FormData, so `Cache-Control` headers don't apply. The in-component `loadedChildrenRef` prevents duplicate queries within one session; across visitors each expand hits the DB.
- **Tree DnD rollback on backend failure** — optimistic cache update is not reverted when `/api/organizations/move` returns `{ ok: false }`. User sees an error toast and can re-drag.
- **No sample people/positions in seed** — seed ships starter orgs + types + regions + member states only. Populate via the UI.
- **Public notification + submission chrome missing** — notifications fire but the bell/inbox UI only lives on tenant layouts. Public visitors get nothing (intentional — they're unauthenticated).
