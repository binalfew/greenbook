# React Router 7 Full-Stack Template

A production-ready template for building multi-tenant SaaS applications on React Router 7. Genericized and opinionated so you can start a new product without re-solving the same ten problems.

## What you get, out of the box

- **Multi-tenancy** — every app-facing route lives under `$tenant/` with tenant isolation enforced at the service layer.
- **Auth + RBAC** — cookie sessions with DB backing, 2FA (TOTP + recovery codes), API keys, impersonation, `requirePermission` / `requireRole` / `requireAnyRole` / `requireFeature` helpers, password history.
- **SSO** — OpenID Connect (Okta, Azure AD, Google, custom) + SAML 2.0, with a full admin UI and auto-provisioning.
- **Privacy** — DSAR workflow (ACCESS / RECTIFICATION / ERASURE / etc.) + consent records + audit-log viewer with CSV export.
- **Events + jobs** — in-process Postgres-backed job queue (`FOR UPDATE SKIP LOCKED`), idempotency keys, domain event bus, SSE, webhook subscriptions with HMAC signatures and circuit breaker.
- **Data patterns** — saved views, custom field definitions, cross-entity global search, typed data export (CSV/JSON), soft-delete via `deletedAt`.
- **Reference data** — tenant-scoped `Country` / `Title` / `Language` / `Currency` with full admin CRUD.
- **Notifications** — in-app bell, SSE listener, toast surface, persisted per-user read state.
- **PWA** — service worker with cache-first static / network-first API / offline fallback, install prompt, update prompt, IndexedDB sync queue, offline banner.
- **i18n** — `en` + `fr` across 12+ namespaces, cookie-persisted, RTL-aware.
- **Settings + feature flags** — DB-backed per-user / per-tenant / global scoping with registry, business-hours profiles, per-flag opt-in/opt-out.
- **Components library** — stable Conform wrapper (`~/components/form`), field wrappers bridging shadcn/Radix to Conform, DataTable with filters + search + pagination + permission-gated actions, cascading-select hook.
- **Observability** — pino logger with correlation IDs (AsyncLocalStorage), request logger, rate-limit violation audit trail, Sentry (client + server), graceful shutdown hook registry.
- **Testing harness** — vitest (unit + integration with a dedicated test Postgres), Playwright E2E with smoke project, MSW mocks, factory helpers.
- **Demo entity** — a full Notes module with categories, comments, tags, soft delete, versioning, and every route pattern the template teaches (shared editor, dialog overlays, escape routes, 2/3+1/3 detail layout) to serve as living documentation.

Everything above is gated via feature flags where appropriate, so apps can disable subsystems they don't need without deleting code.

## Stack

| Layer         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Runtime       | Node 22 (native TypeScript)                                  |
| Framework     | React Router 7 (SSR) + Express                               |
| Database      | PostgreSQL via Prisma 7 + `@prisma/adapter-pg`               |
| UI            | shadcn/ui + Radix primitives + Tailwind CSS 4 + lucide-react |
| Forms         | Conform (stable) + Zod v4                                    |
| Auth          | Cookie sessions + bcrypt + `@sentry/node` for error tracking |
| Observability | pino + AsyncLocalStorage + @sentry/node + @sentry/browser    |
| Testing       | vitest + Playwright + MSW                                    |
| i18n          | i18next + react-i18next + browser language detector          |

## Getting started

### Prerequisites

- Node 22 (see `.node-version`)
- Docker (for local Postgres) or a remote PostgreSQL 16+ instance

### Setup

```bash
# 1. Clone and install
git clone <your-fork-url> my-app
cd my-app
npm install

# 2. Bring up Postgres (dev on :5432, test on :5433)
docker compose up -d db db-test

# 3. Copy env + tweak secrets
cp .env.example .env
# Edit SESSION_SECRET and HONEYPOT_SECRET to strong random values

# 4. Initialise the database
npm run db:push
npm run db:seed

# 5. Start the dev server
npm run dev
```

The app is at <http://localhost:5173>. Default seeded users:

- `admin@example.com` / `admin123` — global admin
- `user@example.com` / `user123` — regular tenant user

## Project layout

```
react-router/
├── app/
│   ├── components/              # UI components (ui/ = shadcn, rest = custom)
│   │   ├── data-table/          # Custom DataTable with filters + actions
│   │   ├── form.tsx             # Stable Conform wrapper + field wrappers
│   │   └── pwa/                 # Install + update prompts
│   ├── hooks/                   # use-base-prefix, use-cascade, use-sse, use-online-status
│   ├── locales/                 # en/*.json + fr/*.json, registered in utils/i18n.ts
│   ├── middleware/              # correlation.server.ts
│   ├── routes/                  # File-based via react-router-auto-routes
│   │   ├── _auth/               # login, signup, 2fa, sso, accept-invite
│   │   └── $tenant/             # Tenant-scoped app (layout + settings + notes + logs)
│   ├── services/                # Business logic (one file per domain, *.server.ts)
│   ├── utils/
│   │   ├── auth/                # Session + RBAC + API key + audit
│   │   ├── config/              # env schema + feature flags + settings
│   │   ├── db/                  # Prisma client
│   │   ├── events/              # Job queue + domain events + webhooks
│   │   ├── monitoring/          # Logger + Sentry
│   │   ├── offline/             # Service-worker registration + sync queue
│   │   └── schemas/             # Cross-cutting Zod schemas (privacy, sso, notes)
│   └── root.tsx                 # SSR shell, auth bootstrap, PWA manifest, Sentry init
├── prisma/
│   ├── schema.prisma            # Single Prisma schema
│   └── seed.ts                  # Idempotent seed (roles, permissions, flags, defaults)
├── public/                      # Service worker, manifest, icons
├── server/                      # Express boot + middleware (correlation, request log, rate limit, CORS, Sentry)
├── tests/
│   ├── unit/                    # vitest unit (MSW-stubbed)
│   ├── integration/             # vitest against db-test Postgres
│   ├── e2e/                     # Playwright
│   ├── factories/               # Test data builders + seed scenarios
│   ├── mocks/                   # MSW handlers + Resend email fixture pipe
│   └── setup/                   # Per-runner bootstrap
└── CLAUDE.md                    # The authoritative pattern guide — read this before editing
```

**Path alias**: `~/*` → `./app/*`.

## Core commands

```bash
# Dev
npm run dev                  # Express + Vite HMR on :5173
npm run typecheck            # react-router typegen && tsc -b
npm run lint                 # tsc -b --noEmit
npm run format               # Prettier

# Database
npm run db:push              # Sync schema to DB (template default — no migration files)
npm run db:seed              # Idempotent seed
npm run db:studio            # Prisma Studio GUI
docker compose up -d db-test # Separate test DB on :5433

# Production
npm run build                # Build client + server bundles
npm run start                # Run the production server

# Testing
npm run test                 # Unit (vitest)
npm run test:integration     # Integration against db-test
npm run test:e2e             # Playwright (chromium project)
npm run test:e2e:ui          # Playwright UI mode
```

## Building on this template

**Start here**: read [CLAUDE.md](./CLAUDE.md). It documents every pattern the template teaches — entity route structure, shared-editor form pattern, dialog-route convention, cascading selects, action error handling, detail-page layout, and per-phase deep dives on every subsystem.

Then look at the **Notes demo entity** (`app/routes/$tenant/notes/`, `app/services/notes.server.ts`, `app/utils/schemas/notes.ts`). It's genuinely small but exercises the full pattern surface — use it as a copy-paste starting point when adding your first domain entity.

## Feature flags

Everything gateable is behind a flag. Inspect them in the UI at `/$tenant/settings/features` (admin-only) or flip them directly in the `FeatureFlag` table. Defaults shipped in `prisma/seed.ts`:

| Key                | Default | Scope  | What it gates                                      |
| ------------------ | ------- | ------ | -------------------------------------------------- |
| `FF_TWO_FACTOR`    | on      | global | TOTP setup + verify + recovery codes               |
| `FF_IMPERSONATION` | off     | global | Admin-as-user session switching                    |
| `FF_REST_API`      | off     | tenant | `/api/*` API-key authenticated routes              |
| `FF_WEBHOOKS`      | off     | tenant | Tenant can register webhook subscriptions          |
| `FF_SSE`           | on      | tenant | Server-sent events (notifications + domain events) |
| `FF_NOTIFICATIONS` | on      | tenant | In-app notification bell + list                    |
| `FF_PWA`           | off     | global | Service worker + manifest + install/update prompts |
| `FF_I18N`          | off     | global | Language switcher in tenant nav                    |
| `FF_SAVED_VIEWS`   | off     | tenant | Per-user saved view filters                        |
| `FF_AUDIT_EXPORT`  | off     | tenant | Export audit log (CSV/JSON)                        |
| `FF_NOTES`         | on      | tenant | Notes demo entity                                  |

## Environment

Required:

- `DATABASE_URL`
- `SESSION_SECRET`
- `HONEYPOT_SECRET`
- `RESEND_API_KEY` (can be a dev placeholder — MSW intercepts in tests)

Optional but recommended in production:

- `APP_URL` — used for OAuth/SAML callbacks (SSO) + email links
- `APP_NAME`, `APP_VERSION` — surface in logs + Sentry
- `LOG_LEVEL` — `info` default
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` — error tracking
- `CORS_ORIGINS` — comma-separated allowlist
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` — override defaults (15 min / 300 req)

See `.env.example` for the full list with notes.

## Deployment

### Docker

```bash
docker build -t my-app .
docker run -p 3000:3000 --env-file .env my-app
```

### Manual

```bash
npm run build
# Deploy build/ + server + node_modules to your host
NODE_ENV=production node ./node_modules/@react-router/serve/dist/cli.js ./build/server/index.js
```

For production:

1. Generate strong values for `SESSION_SECRET` + `HONEYPOT_SECRET` (≥ 32 bytes random).
2. Set `NODE_ENV=production`, `APP_URL=https://your-domain`, `CORS_ORIGINS=https://your-domain`.
3. Wire `SENTRY_DSN` if you want error tracking.
4. Put a reverse proxy in front; `server/app.ts` already calls `app.set("trust proxy", 1)` for a single-hop setup.
5. If you enable `FF_PWA`, ship real icons at `public/icons/`.

## License

MIT — see [LICENSE](./LICENSE) if present, or assume MIT-style permissive terms.

## Contributing

This is an opinionated template, not a framework. If a pattern in the demo app doesn't fit your domain, fork and reshape. Issues and PRs welcome for bugs in the shipped patterns; larger feature asks belong in your fork.
