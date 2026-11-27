# Greenbook

The African Union Commission's staff directory (the "Blue Book"): organizations, the positions inside them, the people who hold those positions, and an editorial workflow that keeps the published record under a manager's control. Built on React Router 7 with server-side rendering.

## What is in the app

- **Directory** — organizations (a hierarchy), people, positions, and position assignments, each scoped to a tenant. People can carry a photo.
- **Editorial workflow** — a focal person's edit becomes a change request (draft, then pending) that a manager approves or rejects; a rejected request can be reopened and resubmitted, and a pending one withdrawn. A manager's own edits apply at once and leave an approved change request behind.
- **Directory search** — a login-gated people search at `/` that spans every tenant opted in through `FF_PUBLIC_DIRECTORY`, with a profile page per person.
- **Multi-tenancy** — every workspace route lives under `$tenant/`. The `system` tenant is the global admin's home and holds no directory records.
- **Auth + RBAC** — cookie sessions backed by the database, email verification codes, password history and expiry, invitations, impersonation, and the `requirePermission` / `requireRole` / `requireAnyRole` / `requireFeature` helpers.
- **SSO** — OpenID Connect and SAML 2.0, configured per tenant under Settings, Security.
- **Reference data** — `Title`, `RegionalGroup`, `MemberState`, `OrganizationType` and `PositionType`, shared by every tenant and edited by the global admin.
- **Notifications** — an in-app bell and list, with read state stored per user. The bell refreshes when the page loads or revalidates; nothing is pushed to the browser.
- **Audit log** — a filterable viewer at `$tenant/logs` with CSV export.
- **Settings + feature flags** — database-backed settings resolved by scope, and feature flags that are either global or opted in per tenant.
- **i18n** — English and French across 13 namespaces, remembered in a cookie.
- **PWA** — service worker, install and update prompts, offline banner, all behind `FF_PWA`.
- **Observability** — pino logger with correlation IDs, request logger, rate limiting with an audit trail, Sentry (client + server), graceful shutdown.
- **Testing harness** — vitest (unit, and integration against a dedicated test Postgres), Playwright, MSW mocks, factory helpers.

## Stack

| Layer         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Runtime       | Node 22                                                      |
| Framework     | React Router 7 (SSR) + Express                               |
| Database      | PostgreSQL via Prisma 7 + `@prisma/adapter-pg`               |
| UI            | shadcn/ui + Radix primitives + Tailwind CSS 4 + lucide-react |
| Forms         | Conform + Zod v4                                             |
| Auth          | Cookie sessions + bcrypt, OIDC and SAML for SSO              |
| Observability | pino + AsyncLocalStorage + @sentry/node + @sentry/browser    |
| Testing       | vitest + Playwright + MSW                                    |
| i18n          | i18next + react-i18next + browser language detector          |

## Getting started

### Prerequisites

- Node 22
- Docker (for local Postgres) or a PostgreSQL instance you can reach

### Setup

```bash
# 1. Clone and install
git clone <repo-url> greenbook
cd greenbook
npm install

# 2. Copy env + set secrets
cp .env.example .env
# Edit SESSION_SECRET and HONEYPOT_SECRET to strong random values, and set
# SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD to the admin login you want

# 3. Bring up Postgres (dev + test containers)
npm run docker:up

# 4. Initialise the database
npm run db:push
npm run db:seed

# 5. Start the dev server
npm run dev
```

The app listens on `PORT` (3000 unless you change it): <http://localhost:3000>.

The Postgres containers publish on the host ports named by `DB_PORT` (default 5432, development) and `DB_TEST_PORT` (default 5433, tests) in `.env`. Change them there when those ports are taken, and keep `DATABASE_URL` in step. The test runners connect to `DATABASE_TEST_URL` when it is set and otherwise build the address from `DB_TEST_PORT`.

### The first account

`npm run db:seed` creates one tenant and one account, and no demo data:

- the `system` tenant, the global admin's home, which holds no directory records;
- the global admin, with the email and password in `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. The seed stops without writing anything when either is missing or the password is under 8 characters.

The password is used only when the account is created; running the seed again never resets it. Sign in as that admin and create the working tenants, and their managers and focal persons, under **Tenants** and **Settings → Security → Users**.

## Project layout

```
greenbook/
├── app/
│   ├── components/              # UI components (ui/ = shadcn, rest = custom)
│   │   ├── data-table/          # DataTable with filters + actions
│   │   ├── directory/           # Change diff, status pill, assignment timeline, photo
│   │   ├── form.tsx             # Conform wrapper + field wrappers
│   │   └── pwa/                 # Install + update prompts
│   ├── hooks/                   # use-base-prefix, use-mobile, use-online-status
│   ├── locales/                 # en/*.json + fr/*.json, registered in utils/i18n.ts
│   ├── middleware/              # correlation.server.ts
│   ├── routes/                  # File-based via react-router-auto-routes
│   │   ├── _auth/               # login, password reset, verify, accept-invite, sso
│   │   ├── _public/             # Directory search at / and person profiles
│   │   └── $tenant/             # Workspace: directory, settings, logs, notifications, profile, tenants
│   ├── services/                # Business logic (one file per domain, *.server.ts)
│   ├── utils/
│   │   ├── auth/                # Session + RBAC + SSO + audit
│   │   ├── config/              # env schema + feature flags + settings
│   │   ├── db/                  # Prisma client
│   │   ├── events/              # Domain event catalog + emitter
│   │   ├── monitoring/          # Logger + Sentry
│   │   ├── offline/             # Service-worker registration + sync queue
│   │   └── schemas/             # Zod schemas (directory, organization, profile, security, sso, tenant)
│   └── root.tsx                 # SSR shell
├── prisma/
│   ├── schema.prisma            # Single Prisma schema
│   └── seed.ts                  # Re-runnable seed (roles, permissions, flags, reference data, system tenant, admin)
├── public/                      # Service worker, manifest, robots.txt
├── server/                      # Express middleware (correlation, request log, rate limit, CORS, Sentry, shutdown)
├── tests/
│   ├── unit/                    # vitest unit
│   ├── integration/             # vitest against the test Postgres
│   ├── e2e/                     # Playwright
│   ├── factories/               # Test data builders
│   ├── mocks/                   # MSW handlers
│   └── setup/                   # Per-runner bootstrap
├── docs/                        # template/ (subsystem notes), deployment/, architecture/
└── CLAUDE.md                    # The pattern guide — read this before editing
```

**Path alias**: `~/*` → `./app/*`.

## Core commands

```bash
# Dev
npm run dev                  # Express + Vite HMR
npm run typecheck            # react-router typegen && tsc -b
npm run lint                 # tsc -b --noEmit
npm run format               # Prettier

# Database
npm run docker:up            # Start the dev and test Postgres containers
npm run db:push              # Sync schema to DB (no migration files); first removes duplicate user-role rows
npm run db:seed              # Re-runnable seed
npm run db:studio            # Prisma Studio GUI

# Production
npm run build                # Build client + server bundles
npm run start                # Run the production server

# Testing
npm run test                 # Unit (vitest)
npm run test:integration     # Integration against the test database
npm run test:e2e             # Playwright
npm run test:e2e:ui          # Playwright UI mode
```

## Working on the code

Read [CLAUDE.md](./CLAUDE.md) first. It maps each subsystem to its files, describes the directory and its editorial workflow, and names a canonical example for common tasks. Per-subsystem notes live under [docs/template/](./docs/template/).

## Feature flags

Flags live in the `FeatureFlag` table and are seeded by `prisma/seed.ts`; the seed removes any flag that is not in this list. A tenant-scoped flag is on for exactly the tenants in its enabled list. `/$tenant/settings/features` lists the flags; a tenant's own opt-ins are managed from its Features page under `/$tenant/tenants/$tenantId/features`.

| Key                   | Scope  | Seeded state       | What it gates                                      |
| --------------------- | ------ | ------------------ | -------------------------------------------------- |
| `FF_DIRECTORY`        | tenant | on for new tenants | The `/$tenant/directory/*` workspace               |
| `FF_PUBLIC_DIRECTORY` | tenant | on for new tenants | Whether the tenant's records appear in the search  |
| `FF_NOTIFICATIONS`    | tenant | on for new tenants | In-app notification bell + list                    |
| `FF_PWA`              | global | off                | Service worker + manifest + install/update prompts |
| `FF_I18N`             | global | off                | Language switcher                                  |

A tenant created through the app is opted into the three tenant-scoped flags.

## Environment

Required:

- `DATABASE_URL`
- `SESSION_SECRET`
- `HONEYPOT_SECRET`
- `RESEND_API_KEY` (a placeholder is enough in development, where outgoing email is mocked)
- `EMAIL_FROM` (sender of every outgoing email)

Optional:

- `PORT` — HTTP port, 3000 by default
- `APP_URL` — used for OIDC/SAML callbacks and email links
- `APP_NAME`, `APP_VERSION` — surface in logs + Sentry
- `LOG_LEVEL` — `info` default
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` — error tracking
- `CORS_ORIGINS` — comma-separated allowlist
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` — override the general limiter (15 min / 300 requests)
- `RATE_LIMIT_SEARCH_WINDOW_MS`, `RATE_LIMIT_SEARCH_MAX` — override the directory search limiter (1 min / 15 requests)
- `AUDIT_SINK`, `AUDIT_LOG_FILE` — where audit records are written

See `.env.example` for the full list with notes.

## Deployment

The step-by-step guide for the African Union environment is in [docs/deployment/](./docs/deployment/README.md).

### Docker

```bash
docker build -t greenbook .
docker run -p 3000:3000 --env-file .env greenbook
```

### Manual

```bash
npm run build
NODE_ENV=production npm run start
```

For production:

1. Generate strong values for `SESSION_SECRET` + `HONEYPOT_SECRET` (≥ 32 bytes random).
2. Set `NODE_ENV=production`, `APP_URL=https://your-domain`, `CORS_ORIGINS=https://your-domain`.
3. Set `SEED_ADMIN_EMAIL` and a generated `SEED_ADMIN_PASSWORD` before the first seed; they are the global admin's login.
4. Wire `SENTRY_DSN` if you want error tracking.
5. If you enable `FF_PWA`, add the icons `public/manifest.json` refers to; the repository ships none.
