# Testing harness (Phase 12)

Phase 12 fleshes out the placeholder test scaffolding with three runners (unit, integration, E2E), MSW HTTP mocks, test-data factories, and a dedicated test Postgres on port 5433.

## Runners

| Runner      | Config                         | What it tests                                                                                              | DB               |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------- |
| Unit        | `vitest.config.ts`             | Services + utils + schemas in isolation. Outbound HTTP stubbed by MSW.                                     | none             |
| Integration | `vitest.integration.config.ts` | Service layer against real Postgres. Truncates all tables `beforeEach`. Serial (`fileParallelism: false`). | `db-test` @ 5433 |
| E2E         | `playwright.config.ts`         | Full-stack happy paths via a real browser. Spins up `npm run dev` on port 3001 against the same test DB.   | `db-test` @ 5433 |

## Commands

```
npm run test               # unit, one-shot
npm run test:watch         # unit, watch mode
npm run test:coverage      # unit + v8 coverage report → tests/coverage/
npm run test:integration   # integration (needs db-test running)
npm run test:e2e           # E2E, chromium project (skips smoke)
npm run test:e2e:ui        # E2E with Playwright UI
```

## Setup files

- `tests/setup/unit-setup.ts` — starts MSW with `onUnhandledRequest: "bypass"`, resets handlers between tests. Flip to `"error"` for strict contract testing.
- `tests/setup/integration-setup.ts` — creates a Prisma client pointed at the test DB, truncates all tables in a single `DO $$ … TRUNCATE CASCADE` block `beforeEach`, exports `prisma` so tests can `import` it for arrange/assert.

## MSW

- `tests/mocks/server.ts` — assembles `setupServer` from the handler list.
- `tests/mocks/handlers.ts` — one handler ships out-of-the-box: Resend's `POST /emails` (captures rendered email to `tests/fixtures/email/<recipient>.json` for assertion).
- `tests/mocks/utils.ts` — fixture I/O (`readFixture`/`createFixture`), Zod-validated `EmailSchema`, and `requireEmail(recipient)` helper for post-action assertions.

Add new handlers in `handlers.ts` whenever the app gains a third-party integration.

## Factories

`tests/factories/index.ts` exports:

- **Builders** (`buildTenant`, `buildUser`, `buildRole`) — pure object builders; spread into `prisma.X.create({ data: ... })`. A shared monotonic counter ensures uniqueness across a suite.
- **`seedActiveUserStatus(prisma)`** — idempotent upsert for the `ACTIVE` UserStatus row the app expects.
- **`seedFullScenario(prisma)`** — creates a tenant + active user + role + UserRole link in one call.

Intentionally thin — no `@faker-js/faker`. Apps needing richer test data install it themselves.

## E2E harness

- Playwright spawns `npm run dev` on `PORT=3001` with `DATABASE_URL` pointing at `db-test`. `reuseExistingServer` keeps the dev server around across runs locally.
- `tests/e2e/global-setup.ts` — runs once before the suite: `prisma db push --accept-data-loss` + `npx tsx prisma/seed.ts` against the test DB.
- Two projects: `chromium` (default, runs everything except `smoke.spec.ts`) and `smoke` (only `smoke.spec.ts`).
- Artifacts land in `tests/test-results/` (traces, screenshots) and `tests/playwright-report/` (HTML report).

## Running the test DB

The template's `docker-compose.yml` already defines a `db-test` service on port 5433 (tmpfs-backed so restarts are clean). Bring it up via:

```
docker compose up -d db-test
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/app_test" npx prisma db push --accept-data-loss
```

Integration and E2E tests connect via the `DATABASE_TEST_URL` env (defaults to the above URL when unset).

## Example tests

Shipped as harness exercises, not production coverage:

- `tests/unit/example.test.ts` — factory sanity check.
- `tests/integration/example.test.ts` — tenant round-trip + unique-slug constraint.
- `tests/e2e/smoke.spec.ts` — `/login` renders (smoke project).

Delete or replace these once you start writing real tests.

## Deviations

- **No `@faker-js/faker` dependency.** The monotonic `unique()` counter is enough for most seeding.
- **No `@testing-library/react`.** React Router's loader/action split means you test loaders server-side (integration) and behavior in the browser (E2E).
- **MSW is Node-only** (`msw/node`). Browser MSW is out of scope.
- **Integration tests serialize** (`fileParallelism: false`). TRUNCATE CASCADE in `beforeEach` means parallel files would clobber each other.
- **E2E uses a single worker** (`workers: 1`). Shared DB.
- **`db-test` runs Postgres on tmpfs** (fast truncation, disposable state).
- **Playwright smoke project matches `smoke.spec.ts` only.**
- **`tests/fixtures/` is gitignored by default.**
- **No CI configuration shipped.** The `reporter: "github"` branch in `playwright.config.ts` adapts output automatically when `CI=true`.
