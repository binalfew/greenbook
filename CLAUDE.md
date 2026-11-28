# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Scope

Greenbook is the African Union Commission's staff directory, built on a multi-tenant React Router 7 template. The template supplies the plumbing (auth, RBAC, multi-tenancy, settings, feature flags, i18n, domain events, notifications, SSO, PWA, observability, testing harness); the directory and its editorial workflow are the product.

The template arrived in numbered phases (`docs/superpowers/specs/2026-04-20-template-extraction-design.md` is the original plan, kept as history). Several subsystems that plan describes were later removed because nothing used them. **These do not exist in the code — do not build on them or document them as present:** a job queue, webhooks, real-time updates over SSE, saved views, custom fields, view filters, a global search service, data export, privacy (DSAR + consent), API keys, two-factor authentication, email invitations (users are created directly under Settings → Security → Users), business hours, `Country` / `Currency` / `Language` reference data, and the Notes demo module.

Per-subsystem notes live under `docs/template/phase-XX-*.md`; the table below links to them.

## Patterns by phase

| Phase | Subsystem                                                                          | Look here                                                                                                                                                                                                                                                                                                                            | Deep dive                                                                                |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1     | Auth + RBAC + audit log                                                            | `app/utils/auth/`, `app/services/{users,roles,permissions}.server.ts`, `app/utils/acting-tenant.server.ts`                                                                                                                                                                                                                           | —                                                                                        |
| 2     | Multi-tenancy                                                                      | `app/routes/$tenant/_layout.tsx`, `app/services/{tenants,tenant-setup,tenant-features}.server.ts`, `app/utils/request-context.server.ts`                                                                                                                                                                                             | —                                                                                        |
| 3     | Settings + feature flags                                                           | `app/utils/config/{settings,feature-flags,tenant-flag-membership}.server.ts`, `app/utils/config/{settings-registry,feature-flag-keys}.ts`, `app/services/tenant-features.server.ts`                                                                                                                                                  | —                                                                                        |
| 4     | i18n                                                                               | `app/utils/i18n.ts`, `app/locales/`, `app/utils/i18n-cookie.server.ts`                                                                                                                                                                                                                                                               | See "i18n" below                                                                         |
| 5     | Components library                                                                 | `app/components/form.tsx`, `app/components/data-table/`                                                                                                                                                                                                                                                                              | [docs/template/phase-05-components.md](docs/template/phase-05-components.md)             |
| 6     | Domain events + notifications                                                      | `app/utils/events/`, `app/services/notifications.server.ts`, `app/routes/$tenant/notifications/`                                                                                                                                                                                                                                     | [docs/template/phase-06-events-jobs.md](docs/template/phase-06-events-jobs.md)           |
| 7     | Saved views, custom fields, search, export — **not shipped**                       | —                                                                                                                                                                                                                                                                                                                                    | [docs/template/phase-07-data-patterns.md](docs/template/phase-07-data-patterns.md)       |
| 8     | Reference data (Title, RegionalGroup, MemberState, OrganizationType, PositionType) | `app/services/reference-data.server.ts`, `app/utils/reference-data-access.server.ts`, `app/routes/$tenant/settings/references/`                                                                                                                                                                                                      | [docs/template/phase-08-reference-data.md](docs/template/phase-08-reference-data.md)     |
| 9     | Audit-log UI (privacy — DSAR + consent — **not shipped**)                          | `app/routes/$tenant/logs/`                                                                                                                                                                                                                                                                                                           | [docs/template/phase-09-privacy-audit.md](docs/template/phase-09-privacy-audit.md)       |
| 10    | SSO (OIDC + SAML)                                                                  | `app/services/sso.server.ts`, `app/utils/auth/{oidc,saml,sso-state}.server.ts`, `app/routes/_auth/sso/`, `app/routes/$tenant/settings/security/sso/`                                                                                                                                                                                 | [docs/template/phase-10-sso.md](docs/template/phase-10-sso.md)                           |
| 11    | PWA + offline                                                                      | `public/sw.js`, `public/manifest.json`, `app/utils/offline/`, `app/components/{offline-banner,pwa/*}.tsx`                                                                                                                                                                                                                            | [docs/template/phase-11-pwa.md](docs/template/phase-11-pwa.md)                           |
| 12    | Testing harness                                                                    | `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `tests/`                                                                                                                                                                                                                                                 | [docs/template/phase-12-testing.md](docs/template/phase-12-testing.md)                   |
| 13    | Observability (logger/correlation/rate limit/Sentry/shutdown)                      | `app/utils/monitoring/`, `app/middleware/correlation.server.ts`, `server/{logger,correlation,request-logger,sentry,shutdown}.js`, `server/{app,security,rate-limit-audit}.ts`                                                                                                                                                        | [docs/template/phase-13-server-hardening.md](docs/template/phase-13-server-hardening.md) |
| 15    | Docs polish                                                                        | `README.md`, `.env.example`                                                                                                                                                                                                                                                                                                          | [docs/template/phase-15-docs-polish.md](docs/template/phase-15-docs-polish.md)           |
| app   | Directory (Greenbook domain — AU Blue Book)                                        | `app/services/{organizations,people,positions,position-assignments,directory-changes,directory-notifications,person-photos,person-duplicates,public-directory}.server.ts`, `app/routes/$tenant/_directory/`, `app/utils/{directory-access,directory-submit}.server.ts`, `app/utils/directory-routes.ts`, `app/components/directory/` | See "Directory + editorial workflow" below                                               |

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
npm run docker:up        # Start PostgreSQL (dev + test containers; host ports from DB_PORT / DB_TEST_PORT)
npm run docker:down      # Stop containers
npm run db:push          # Remove duplicate user-role rows (upgrade step), then sync Prisma schema to DB
npm run db:seed          # Seed roles, permissions, feature flags, reference data, the system tenant and the global admin
npm run db:studio        # Prisma Studio GUI
```

> The host ports default to 5432 (development) and 5433 (tests). They are set by `DB_PORT` and `DB_TEST_PORT` in `.env`, which `docker-compose.yml`, `vitest.integration.config.ts`, `playwright.config.ts` and `tests/e2e/global-setup.ts` all read; `DATABASE_TEST_URL`, when set, wins over `DB_TEST_PORT`. Do not assume 5432/5433 — check `.env`.

> The project uses `prisma db push` rather than `prisma migrate`. No migration files are versioned. Generate a migration baseline (`npx prisma migrate dev --create-only --name init`) when schema changes need to be locked down.

### Testing

```bash
npm run test             # Unit tests (vitest)
npm run test:watch       # Unit tests in watch mode
npm run test:coverage    # Unit tests with coverage
npm run test:integration # Integration tests against the test DB (DATABASE_TEST_URL, else DB_TEST_PORT)
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
- **Auth:** Cookie-based sessions with DB backing, emailed verification codes, password history, impersonation, SSO (OIDC + SAML)
- **Events:** domain events recorded in the structured log (`emitDomainEvent`); no queue, no outbound delivery, nothing pushed to the browser
- **Observability:** pino logger, AsyncLocalStorage correlation IDs, Sentry (client + server), rate-limit audit trail
- **i18n:** i18next with en + fr, cookie-persisted, 13 namespaces
- **PWA:** service worker (cache-first static / network-first API / offline fallback), install + update prompts, IndexedDB sync queue
- **Testing:** vitest (unit + integration against a dedicated `db-test` Postgres) + Playwright (E2E + smoke project) + MSW mocks

### Project Layout

- `app/routes/` — File-based routing via `react-router-auto-routes`. Folders prefixed with `+` are ignored by auto-routes (colocates shared editor components next to their routes).
- `app/components/ui/` — shadcn/ui components (do not edit; use `npx shadcn add`).
- `app/components/` — Custom components.
- `app/utils/` — Core utilities, organized into subdirectories. Files ending in `.server.ts` are server-only.
  - `app/utils/auth/` — session, verification, CSRF, honeypot, user helpers, permissions, OIDC/SAML, audit
  - `app/utils/db/` — Prisma client with Postgres adapter wiring
  - `app/utils/email/` — email sending via Resend
  - `app/utils/config/` — environment variable parsing, settings SDK, feature-flag SDK + client-safe keys
  - `app/utils/events/` — domain event catalog + emitter
  - `app/utils/monitoring/` — pino logger + Sentry (client + server)
  - `app/utils/offline/` — service-worker registration + IndexedDB sync queue
  - `app/utils/schemas/` — Zod schemas (directory, organization, profile, security, sso, tenant)
  - `app/utils/constants/` — shared constants (person photo limits, SSO provider lists)
- `app/middleware/` — request-scoped helpers (correlation ID + AsyncLocalStorage)
- `app/services/` — business logic (one file per domain, `.server.ts`)
- `app/locales/` — i18n JSON (en/ + fr/), one file per namespace, registered in `utils/i18n.ts`
- `app/hooks/` — client hooks (`use-base-prefix`, `use-mobile`, `use-online-status`)
- `server/` — Express app boot + middleware (logger, correlation, rate limit, Sentry, shutdown).
- `public/` — static assets (`sw.js`, `manifest.json`, `robots.txt`; no icon files are shipped).
- `prisma/schema.prisma` — Database schema.
- `prisma.config.ts` — Prisma 7 configuration file (datasource URL lives here, not in schema).
- `tests/` — `unit/`, `integration/`, `e2e/`, and `setup/`.
- `docs/template/` — Per-phase deep dives (shape, conventions, deviations).

Path alias: `~/*` maps to `./app/*`.

## Code Conventions

- **Formatting:** Prettier — double quotes, semicolons, trailing commas, 100-char width, 2-space indent.
- **Commits:** Conventional Commits enforced by commitlint. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`. Max subject 100 chars.
- **Pre-commit:** Husky + lint-staged runs Prettier on staged files. Git `core.hooksPath` is `.husky/_`.
- **Server-only code:** `.server.ts` suffix — excluded from client bundles by React Router.
- **Node version:** 22 (leverages native TypeScript support via type stripping).

## Core patterns reference

Task-based quick index for common work:

| Task                                | Canonical example                                                                                                               | Docs                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Wire a form                         | `app/routes/$tenant/_directory/organogram/+shared/organization-editor.tsx`                                                      | `docs/template/phase-05-components.md`                                       |
| Dialog overlay on a detail page     | `app/routes/$tenant/_directory/organogram/$orgId.delete.tsx`                                                                    | "Directory" section below                                                    |
| Trailing-underscore escape          | `app/routes/$tenant/_directory/organogram/$orgId_/edit.tsx`                                                                     | "Directory" section below                                                    |
| Tenant-scoped list with filters     | `app/routes/$tenant/_directory/organogram/index.tsx`                                                                            | `docs/template/phase-05-components.md`                                       |
| Gate by feature flag                | `requireTenantFeature(request, "FF_NAME")`                                                                                      | `app/utils/auth/require-auth.server.ts`                                      |
| RBAC check                          | `requirePermission(request, "resource", "action")`; `requireTenantPermission(...)` when the route acts on the tenant in the URL | `app/utils/auth/require-auth.server.ts`, `app/utils/acting-tenant.server.ts` |
| Structured logging with correlation | `getRequestLogger()` from `~/middleware/correlation.server`                                                                     | `docs/template/phase-13-server-hardening.md`                                 |

The per-phase docs under `docs/template/` each end with a "Deviations" block — skim these before starting new work, they flag the places where the template deliberately stopped short.

## When working in this codebase

- **Follow existing patterns** — the per-phase docs in `docs/template/` are the canonical shape of each subsystem.
- **Keep the `.server.ts` boundary clean** — never import `.server.ts` code from client-only modules.
- **Respect the `+` prefix** — folders like `app/routes/+shared/` are deliberately ignored by auto-routes.
- **Don't reintroduce `app/lib/`** — Phase 0 moved all utilities into `app/utils/` with domain subdirectories.

## i18n

The app ships `en` and `fr` locales across 13 namespaces: `common`, `auth`, `validation`, `nav`, `settings`, `users`, `notifications`, `references`, `logs`, `sso`, `pwa`, `directory`, `directory-public`. Language state is persisted in the `i18n_lang` cookie (1-year TTL). The `<LanguageSwitcher>` in the tenant top-nav is gated on the `FF_I18N` feature flag and the per-tenant `i18n.supported_languages` setting.

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

Four entities. `Organization` and `Position` have **no `tenantId`**: there is one organogram and one set of positions, shared by every tenant and kept by the global admin, like the reference data below. `Person` and `PositionAssignment` are tenant-scoped, so a shared position is held by each tenant's own people: every read of a position made for a tenant (`listPositions`, `listPositionsForOrganization`, `getPosition`) takes that tenant's id and counts and lists that tenant's assignments only, and the public helpers show holders from opted-in tenants only. Never return a position's assignments without one of those filters.

- **`Organization`** — shared; hierarchical, self-referencing `parentId`, typed via `OrganizationType` (ROOT / MAIN_ORGAN / DEPARTMENT / OFFICE / UNIT).
- **`Person`** — individual record with `honorific`, contact fields, `memberStateId` (nationality), `showEmail` / `showPhone` public-visibility toggles, and an optional photo (`photoId` → `PersonPhoto`, which holds the image bytes; `app/services/person-photos.server.ts`).
- **`Position`** — shared; formal post inside an org, with a `reportsToId` self-reference for internal reporting chains.
- **`PositionAssignment`** — tenant-scoped temporal link between a tenant's Person and a shared Position (`startDate`, `endDate`, `isCurrent`). Auto-closes the prior current assignment when a new one starts on the same position **within the same tenant**; two tenants can each have a current holder of one position.

Supporting reference data: `RegionalGroup` (5 AU regions), `MemberState` (55 member states with region joins), `OrganizationType`, `PositionType`, plus `Title`. These tables have no `tenantId`: one set is shared by every tenant, seeded create-only by `seedDirectoryReference()` / `seedTitles()` in `prisma/seed.ts`, and only the global admin can edit it (`app/utils/reference-data-access.server.ts`).

### Editorial workflow (ChangeRequest engine)

Every mutation flows through `app/services/directory-changes.server.ts`. The real entity tables hold only published state; proposed changes live as `ChangeRequest` rows with status `DRAFT → PENDING → APPROVED | REJECTED | WITHDRAWN`.

- **Organogram and positions are the global admin's, and shared.** The admin edits them from any directory-enabled tenant's workspace (`/<tenant>/organogram`, `/<tenant>/positions`; the system tenant has no directory pages); the change request is recorded in that tenant, the record itself belongs to none. Only the `admin` role holds `organization:{write,delete}` and `position:{write,delete}`, and `directory-change:submit` does not reach those two entities: focal persons and managers read organizational units and positions but cannot create, edit, move or delete them. `requireDirectoryAccess` reports this as `canPropose` (false for `organization` / `position`), and `directoryContext()` puts both entity types on `ChangeContext.lockedEntityTypes` for anyone without the write permission, so the engine refuses to save, submit, reopen or approve such a change with `ADMIN_MANAGED` (rejecting, withdrawing and discarding stay open, so requests older than the rule can be closed). People and position assignments follow the workflow below.
- **Focal persons** (role `focal`) hold `directory-change:submit`. Their edits to people and assignments `saveDraft()` — a `DRAFT` is private to its author and never reaches the approval queue. `submitDrafts(ids, ctx)` moves the author's drafts to `PENDING` (same batch cap and skipped/failed reporting as batch approve; stale-edit and one-open-change checks run here) and notifies approvers once per call. The record doesn't change until a manager approves.
- **Managers** (role `manager`) hold `{person,position-assignment}:write`. Their direct edits `submitAndApply()` — creates a self-approved ChangeRequest + applies in one transaction.
- **One PENDING per `(entityType, entityId)`** enforced in service (future partial unique DB index).
- **Reopening a rejection** — `reopenRejectedChange(id, ctx)` turns the author's own `REJECTED` request into a new `DRAFT` carrying the rejected payload and a `clonedFromId` link back. The rejected request stays in history untouched; `canReopenChange` decides whether the button shows.
- **Discarding a draft** — `discardDraft(id, ctx)`, author only. Drafts never appear in the approval queue or to other users.
- **Possible duplicates** — `findPossibleDuplicatePeople` (`app/services/person-duplicates.server.ts`) flags people in the same tenant who look like the one being created or edited; the person editor and the change-detail page show the warning. It is a warning, not an error: the editor holds the first save back and lets the author confirm and save anyway.
- **Approval runs in a single `$transaction`** — `_applyCreate/Update/Move/SoftDelete` writers each accept an optional `tx: Prisma.TransactionClient` so guards, writes, and the ChangeRequest update commit atomically.
- **Batch approve/reject** via `approveChanges(ids, ...)` / `rejectChanges(ids, ...)` — per-id atomic loop, capped at `MAX_BATCH_SIZE = 100`. NOT_FOUND / NOT_PENDING become `skipped` in the `BatchResult` rather than `failed`.
- **Domain events** — entity-level events (`organization.created`, etc.) fire **only on approval**; a parallel event stream (`change.submitted`, `change.approved`, `change.rejected`, `change.withdrawn`) drives workflow consumers. Catalog in `app/utils/events/domain-events.ts`.

### Cross-tenant directory tier (Phase D — shipped, login-gated since the post-demo change)

Naming note: "public" in this section — the `public*` service helpers, `app/routes/_public/`, `FF_PUBLIC_DIRECTORY`, the `directory-public` namespace — now means **cross-tenant and tenant-blind**, not anonymous. Every route here requires a logged-in user.

- Admin is tenant-scoped; the public surface is a single cross-tenant unified directory rooted at `/` (no tenant slug). Visitors never see the word "tenant." (Slugs `directory` and `public` are both reserved in `app/utils/reserved-slugs.ts`, the single reserved-slug list, so no tenant can collide.)
- **Post-demo change:** the directory search now **requires login** (AU staff + member states only). `/` and `/people/$personId` call `requireUserId`; `/api/search-people` returns 401 when unauthenticated. Search needs ≥3 characters, paginates at 5/page, matches people by name/bio **and** current position title + organization, and is rate-limited (`searchLimiter`, default 15/min per user, mounted in `server/app.ts`).
- `app/services/public-directory.server.ts#getPublicTenantIds()` — 5-min-cached gate that returns tenant ids where `FF_PUBLIC_DIRECTORY` is on.
- `public*` helpers on each entity service (`publicListOrganizationTreeRoots`, `publicListOrganizationChildren`, `publicGetOrganization`, `publicListPeople`, `publicGetPerson`, `publicGetPosition`) accept the opted-in tenant set as an argument and **never include `tenantId`** in their response shape. An integration test asserts this invariant per helper.
- PII strip for `Person`: `email` / `phone` are returned only when `showEmail` / `showPhone` is true. Same strip applied in list + detail.
- Shared utility: `app/utils/public-directory.server.ts` exports `getPublicContext()` (one-call gate), `PUBLIC_CACHE_HEADER` (`public, max-age=60, stale-while-revalidate=300`), `publicCacheHeaders()`, and `publicOrgToTreeNode()` (reshapes `PublicOrgNode` into the include-shape the admin tree wrappers expect, so the public tree reuses `OrganizationHierarchyTree` with `canMove={false}`).
- Directory loaders (`/`, `/people/$personId`) call `requireUserId` but **never** `resolveTenant` — they stay cross-tenant. Because responses are per-session, each loader and its `headers()` export return `Cache-Control: private, no-store`; `/api/search-people` uses `private, max-age=15`. `PUBLIC_CACHE_HEADER` is no longer used by any wired route — do not put it back on an auth-gated response, or a shared cache could serve one user's results to another.
- `public/robots.txt` disallows everything (`Disallow: /`) — every page is either login-gated or an auth form, so nothing is indexable.
- Detail-page 404s throw a `Response(status: 404)` with the same `private, no-store` header; each detail route's `ErrorBoundary` renders the shared `~/components/public/not-found.tsx#PublicDetailNotFound` with `kind` in `"org" | "person" | "position"`.
- Public routes actually shipped live under `app/routes/_public/*` (a pathless layout, so children sit at the domain root — **not** `app/routes/directory/*`): `_layout.tsx` (AU chrome + language switcher, auth-aware header), `index.tsx` (the `/` people search + pagination; also the operator shortcut that bounces admins/managers/focals to their tenant dashboard; they search from `app/routes/$tenant/directory/`, which renders the same `~/components/public/directory-search.tsx` and `person-profile.tsx` inside the workspace chrome), and `people/$personId.tsx` (profile with `AssignmentTimeline`). The type-ahead API is `app/routes/api.search-people.tsx`. The org-tree and position public detail routes are **not currently wired** — `publicGetOrganization` / `publicListOrganizationTreeRoots` / `publicListOrganizationChildren` / `publicGetPosition` exist in the services but are referenced only from tests; re-wiring them will resurface the dormant `isActive` gaps noted in their code. Static-segment precedence means `/` and `/people/*` win over `/:tenant/*` at the auto-routes level.

### Phase E additions

Post-MVP polish that landed alongside the cross-tenant directory tier:

- **Notifications on workflow transitions** (`app/services/directory-notifications.server.ts`). `submitDrafts` notifies every user in the tenant with `directory-change:approve` (except the submitter) once per call, however many drafts it carries. `approveChange` / `rejectChange` notify the submitter with the reviewer's name + reject notes when present. All fire-and-forget: failures are logged, never unwind the approval transaction. Skip when reviewer = submitter.
- **Reference-id hydration in diffs** (`computeDiff` in `directory-changes.server.ts`). Per-field cuid references — `parentId`, `typeId`, `organizationId`, `reportsToId`, `memberStateId`, `personId`, `positionId` — resolve to human-readable names in the approval UI. Uses `REFERENCE_FIELDS` + `resolverFor` tables per `DirectoryEntityKey`; each resolver runs a single `findMany` across all referenced ids.
- **`AssignmentTimeline` on public pages.** `publicGetPerson` now returns `history: PublicPersonTimelineEntry[]` (capped at 50, same ceiling as `publicGetOrganization.positions`). The public person + position detail pages drop the hand-rolled list renderer and render `AssignmentTimeline` with `mode="byPerson"` / `"byPosition"`.
- **i18n'd tree toolbar.** `HierarchyTree` accepts a `labels` prop with `expandAll / collapseAll / moving / placeholder / resultCount`. `OrganizationHierarchyTree` threads it through; both the admin (`directory` namespace) and public (`directory-public` namespace) routes pass locale-bound values.
- **Tenant-scoped flags.** They ignore the `enabled` boolean — membership in `enabledForTenants` is the actual gate. A tenant gets on the lists when it is created (`NEW_TENANT_FLAGS`); the seed puts no tenant on them.

### Routes (admin, `app/routes/$tenant/_directory/`)

```
_layout.tsx                                       — access gate only. The folder is pathless: its routes are served
                                                    at `/<tenant>/people` etc., with no `/directory` segment, and the
                                                    sidebar (`app/config/navigation.ts`) links to each one. The KPI
                                                    overview is the tenant dashboard, `app/routes/$tenant/index.tsx`
submissions/                                      — the author's own change requests, every status
  index.tsx (the list; `?status=DRAFT` is the drafts list, select + submit for review)
  $changeId._layout.tsx (one submission, as its author sees it)
  $changeId.withdraw.tsx, .discard.tsx, .reopen.tsx (dialogs)
  submit-drafts.tsx (resource route)
+shared/change-detail.{tsx,server.ts}             — the change page both `submissions/$changeId` and
                                                    `approvals/$changeId` render; `view` is `author` or `reviewer`
photos.$photoId.tsx                               — serves a person photo to a member of the tenant
organogram/                                        — the `Organization` records; called "Organogram" (section) and
                                                    "organizational unit" (record) in the UI and URL only
  index.tsx, tree.tsx, new.tsx, $orgId._layout.tsx,
  $orgId_/edit.tsx, $orgId.delete.tsx,
  +shared/organization-editor.{tsx,server.tsx}
people/
  index.tsx, new.tsx, $personId._layout.tsx,
  $personId_/edit.tsx, $personId.delete.tsx,
  $personId.assign.tsx (dialog),
  +shared/person-editor.{tsx,server.tsx}
positions/
  index.tsx, new.tsx, $positionId._layout.tsx,
  $positionId_/edit.tsx, $positionId.delete.tsx,
  $positionId.assign.tsx (dialog),
  $positionId.assignments.$assignmentId.end.tsx (dialog),
  +shared/position-editor.{tsx,server.tsx}
approvals/
  _layout.tsx (permission gate)
  index.tsx (pending queue; selectable + batch dialog for reject notes)
  $changeId._layout.tsx (one change, as a reviewer sees it; sends its author to `submissions/$changeId`)
  $changeId.approve.tsx, .reject.tsx (dialogs)
  batch-approve.tsx, batch-reject.tsx (resource routes)
api/
  organizations.children.tsx, organizations.move.tsx (tree lazy-load + drag-and-drop move)
```

### Key helpers

| Helper                                                                                | File                                               | Purpose                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requireDirectoryAccess(request, { write? })`                                         | `app/utils/directory-access.server.ts`             | Resolves `{ user, tenantId, canDirect, canSubmit, canPropose, canReview }` in one call; `canPropose` is `canSubmit` for a resource a focal person may propose changes to |
| `directoryContext(request, access)`                                                   | same                                               | The `ChangeContext` every directory route passes to the engine: the service context plus the entity types this user may not change                                       |
| `requireDirectoryWriteAccess(request, resource)`                                      | same                                               | Gates new/edit/delete loaders — fails 403 if neither direct-write nor `canPropose`                                                                                       |
| `requireReviewContext(request)` / `requireSubmitContext(request)`                     | same                                               | Collapses `requireDirectoryAccess + buildServiceContext` for approval/submission routes                                                                                  |
| `dispatchDirectoryChange(request, resource, input)`                                   | `app/utils/directory-submit.server.ts`             | Editor actions call this; routes through `submitAndApply` (manager) or `saveDraft` (focal person; `?draft=<id>` updates that draft) based on permissions                 |
| `dispatchDirectoryDelete(request, resource, entityType, id, reason?)`                 | same                                               | Convenience wrapper for DELETE dialogs                                                                                                                                   |
| `directoryEntitySegment(entity)`                                                      | `app/utils/directory-routes.ts`                    | Maps `DirectoryEntity` enum to admin URL segment (for deep-links from the change-detail page)                                                                            |
| `submissionsPath` / `draftsPath` / `draftEditPath` / `personPhotoPath`                | same                                               | URL builders for the author's submissions list, its drafts view, the editor that resumes a draft, and a tenant photo                                                     |
| `submissionPath` / `changePath`                                                       | same                                               | One change request on the author's page (`/submissions/<id>`) and on the reviewer's (`/approvals/<id>`)                                                                  |
| `requireApproveContext(request)` / `requireRejectContext(request)`                    | `app/utils/directory-access.server.ts`             | Review context gated on the specific `directory-change:approve` / `:reject` permission                                                                                   |
| `loadEditorDraft(...)` / `directoryConflictFrom(request, err)`                        | `app/utils/directory-submit.server.ts`             | Editor loaders resume a draft from `?draft=<id>`; editor actions turn a stale-edit or open-change conflict into a form message                                           |
| `requireActingTenant(request)` / `requireTenantPermission(request, resource, action)` | `app/utils/acting-tenant.server.ts`                | Resolves the tenant in the URL and checks the user may act on it (own tenant, or global admin)                                                                           |
| `PendingBadge`                                                                        | `app/components/directory/pending-badge.tsx`       | Amber pill shown on entity detail pages when a pending change exists                                                                                                     |
| `ChangeStatusPill`                                                                    | `app/components/directory/change-status-pill.tsx`  | Status badge across queue + detail                                                                                                                                       |
| `ChangeDiff`                                                                          | `app/components/directory/change-diff.tsx`         | Renders `FieldDiff[]` from `computeDiff()` as field / before / after                                                                                                     |
| `AssignmentTimeline`                                                                  | `app/components/directory/assignment-timeline.tsx` | Vertical timeline of assignments; used on Person + Position detail pages                                                                                                 |

### Form schemas

`app/utils/schemas/directory.ts` separates two schema families:

- **Payload schemas** (`organizationPayloadSchema`, `personPayloadSchema`, etc.) — applied by the change-request engine's `validatePayload`. Include transforms (`nullableString`, `nullableCuid`, `isoDate`) that normalise `""` → `null` etc.
- **Form schemas** (`organizationFormSchema`, `personFormSchema`, `positionFormSchema`, `assignPersonFormSchema`, `endAssignmentFormSchema`) — consumed by the shared editor components. Deliberately **no transforms** to avoid Conform re-submit edge cases; transforms happen at the engine's `validatePayload` boundary.

### Permissions + roles

Under module `directory`:

- `organization:{read,write,delete}` / `person:*` / `position:*` / `position-assignment:*`
- `directory-change:submit` / `:withdraw-own` / `:read-own` / `:read-all` / `:approve` / `:reject`

There are four roles, and they are global: each is one row with `tenantId = null`, created by `upsertGlobalRole` in `prisma/seed.ts` and shared by every tenant. Roles are not seeded per tenant. `Role.scope` says where a role's permissions reach:

- `admin` (scope `GLOBAL`) — every permission, in every tenant
- `user` (scope `GLOBAL`) — reads and updates their own user record; a directory reader
- `focal` (scope `TENANT`) — directory reads + `directory-change:{submit, withdraw-own, read-own}` in the user's home tenant; proposes changes to people and assignments only
- `manager` (scope `TENANT`) — everything `focal` has + writes and deletes on `person` and `position-assignment` (not `organization` or `position`) + `directory-change:{read-all, approve, reject}` + `user:{read,create,update,delete}` and `role:read` in the user's home tenant

The seed creates one tenant and one account, and no demo data: the `system` tenant and the global admin, whose email and password come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (`adminAccountFromEnv` in `prisma/seed.ts`). The seed stops before writing anything when either is missing or the password is under 8 characters, and it never resets the password of an account that exists. There is no demo tenant, no seeded focal person, manager or reader, and no starter directory: working tenants and their users are created in the UI. Do not reintroduce an account with a built-in password.

The `system` tenant is admin-only: it holds no people, assignments or change requests, is on neither directory flag's enabled list, and no user in it can hold a tenant-scope role (`SystemTenantRoleError` in `app/services/users.server.ts`, `SystemTenantDirectoryError` in `app/services/tenant-features.server.ts`). It is recognised by its slug (`SYSTEM_TENANT_SLUG`), which cannot be changed, and it cannot be deleted (`updateTenant` / `deleteTenant` in `app/services/tenants.server.ts`). The seed step `emptySystemTenantDirectory` (`prisma/seed-system-tenant.ts`) moves the people, assignments and change requests an older database kept there into the `misd` tenant, when that tenant exists.

### Feature flags

- `FF_DIRECTORY` — gates the directory admin routes (`app/routes/$tenant/_directory/*`, served at `/$tenant/organogram`, `/$tenant/people`, …) and the directory counts on the tenant dashboard, evaluated against the tenant in the URL for every user, the global admin included (on for new tenants; never for the system tenant).
- `FF_PUBLIC_DIRECTORY` — **opts the tenant into the unified public directory** (on for new tenants; never for the system tenant). Public helpers aggregate across opted-in tenants via `getPublicTenantIds()`.

### Deviations + open issues

- **E2E smoke test skipped** — `tests/e2e/directory-flow.spec.ts` contains a working skeleton of the focal → manager → public round trip but is `test.skip`'d: dev-mode SSR latency pushes three sequential page loads past Playwright's per-test budget. Fix requires running against `npm run build && npm run start` or splitting into three smaller tests.
- **CSV bulk import** — deferred to Phase F.
- **Migration baseline** — still on `db push` like the rest of the template.
- **Assignment timeline pagination** — `publicGetPerson.history` capped at 50. A person with >50 recorded posts needs a dedicated timeline pagination route.
- **Tree lazy-load bypasses HTTP cache** — each tree expand is a POST FormData, so `Cache-Control` headers don't apply. The in-component `loadedChildrenRef` prevents duplicate queries within one session; across visitors each expand hits the DB.
- **Tree DnD rollback on backend failure** — optimistic cache update is not reverted when `/api/organizations/move` returns `{ ok: false }`. User sees an error toast and can re-drag.
- **No notification chrome on the directory search surface** — notifications fire but the bell/inbox UI only lives on tenant layouts. Users on `/` and `/people/*` are now logged in but still see no bell; operators get it once they're in their tenant workspace, and plain `user`-role readers receive no workflow notifications anyway.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `binalfew/greenbook`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.
