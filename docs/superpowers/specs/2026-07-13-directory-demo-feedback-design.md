# Directory — Post-Demo Feedback Hardening

**Date:** 2026-07-13
**Status:** Design (awaiting approval)
**Scope:** Greenbook directory module (`app/services/{people,positions,organizations}.server.ts`, `app/routes/_public/*`, `app/utils/auth/audit.server.ts`, `server/security.ts`)

## Context

After the demo, stakeholders raised eight items. This spec resolves them. Two were locked with the user up front:

- **Login gate scope:** the entire public directory (`/`, `/people/:id`, `/positions/*`, search APIs) requires an authenticated session. The directory is for AU staff and Member States only.
- **Audit sink:** app audit events emit as structured stdout log lines (pino) for an external collector, controlled by an `AUDIT_SINK` env var; DB writes become optional.

## The eight items → workstreams

| #   | Feedback                                                       | Status / Work                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Contact info (email/phone) for Organizations                   | **Already shipped** — `Organization.{email,phone,website,address}` exist in schema, editor, both Zod schemas, and admin detail (`$orgId._layout.tsx:221`). Verify only. |
| 2   | Optional additional contact for Head-of-Unit-and-above persons | **A** — add `officeEmail`/`officePhone` to `Person`.                                                                                                                    |
| 3   | Login required for any search                                  | **B** — gate all `_public/*` loaders + search APIs with `requireUser`.                                                                                                  |
| 4   | Search should start at 3 letters                               | **C** — min query length 3.                                                                                                                                             |
| 5   | Show 5 results / paginate at 5+                                | **C** — public page size 5.                                                                                                                                             |
| 6   | Search by Positions                                            | **C** — new public positions search + detail.                                                                                                                           |
| 7   | Rate-limit search ~10–15/min                                   | **D** — `searchLimiter` (15/min).                                                                                                                                       |
| 8   | Audit logs stored outside the DB                               | **E** — stdout audit sink.                                                                                                                                              |

---

## Workstream A — Person official contact fields (item 2)

The wording ("Head of units and above … additional contact besides personal AU emails") describes _who_ uses these fields, not a hard seniority rule. We add two always-optional fields available on any Person; editors populate them for senior staff as needed. No seniority logic (YAGNI).

- **Schema** (`prisma/schema.prisma`, `Person`): add `officeEmail String? @db.VarChar(255)`, `officePhone String? @db.VarChar(50)`. `npm run db:push`.
- **Zod** (`app/utils/schemas/directory.ts`): add to `personPayloadSchema` (`nullableString`) and `personFormSchema` (`formText`).
- **Editor** (`people/+shared/person-editor.tsx`): add two inputs under a grouped "Official / additional contact" label, distinct from the personal email/phone group.
- **Public exposure:** these are _official_ contacts meant to be shared, so unlike personal `email`/`phone` (gated by `showEmail`/`showPhone`) they are surfaced whenever present — no toggle. `publicGetPerson` adds them to its `select` and return shape; the person detail page renders them in the contact block.
- **i18n:** add `people.fields.officeEmail` / `officePhone` labels (en + fr) in the `directory` namespace, plus `directory-public` labels for the public detail block.

## Workstream B — Login gate on the public directory (item 3)

All of `/_public/*` and the search APIs move behind `requireUser(request)` (redirects anonymous visitors to `/login?redirectTo=…`). The existing operator shortcut in `_public/index.tsx` (authenticated tenant users bounced to `/{slug}`) is preserved, so the flow becomes:

- Anonymous → `requireUser` throws redirect to `/login`.
- Authenticated **tenant** user → redirected to their admin dashboard (existing behaviour).
- Authenticated **tenantless** user (AU staff / Member State SSO, no tenant) → sees the search UI.

**Gate points:** `_public/_layout.tsx`, `_public/index.tsx`, `_public/people/$personId.tsx`, `api.search-people.tsx`, and the new positions routes each call `requireUser` at the top of their loader. (Gating the layout alone is insufficient — RR7 runs child loaders concurrently, so each must gate independently.)

**Caching:** gated responses are per-user. Every gated loader drops `PUBLIC_CACHE_HEADER` in favour of `Cache-Control: private, no-store`. `PUBLIC_CACHE_HEADER` is removed from these routes. `robots.txt` continues to disallow the now-private paths (harmless).

**Chrome:** `_public/_layout.tsx` currently branches on `currentUser`. Post-gate, `currentUser` is always set, so the "Sign In" branch becomes dead; keep it for safety but the user chip + Sign-out is the live path.

## Workstream C — Search rules & positions search (items 4, 5, 6)

**Min length 3:** `AUTOCOMPLETE_MIN_LENGTH` in `app/utils/autocomplete.ts` changes `2 → 3` (drives both the type-ahead API and the client debounce guard). The full-results loaders (`index.tsx`, new positions index) treat a trimmed query of length 1–2 the same as empty: they show a "type at least 3 letters" prompt and never hit the DB.

**Page size 5:** `PAGE_SIZE` in `_public/index.tsx` changes `20 → 5`; the new positions index uses the same. Pagination UI already exists and is reused.

**Positions search:** the public surface has no positions pages yet.

- **Service:** new `publicListPositions(publicTenantIds, { search?, page?, pageSize? })` in `positions.server.ts`. Searches `title` and organization `name`/`acronym` (case-insensitive), tenant-filtered to opted-in ids, **never** returns `tenantId`. Returns each position's title, org, type, and current holder (from the current `PositionAssignment`). Mirrors the `publicListPeople` shape/invariants; an integration test asserts no `tenantId` leaks.
- **Type-ahead API:** new `api.search-positions.tsx` mirroring `api.search-people.tsx` (min-length 3, `SUGGESTION_LIMIT`, gated).
- **Routes:** `_public/positions/index.tsx` (search + 5/page pagination, reuses the `SearchBox`/`Pagination`/`EmptyState` components — these get extracted from `index.tsx` into a shared `_public/+shared/` module so both people and positions reuse them) and `_public/positions/$positionId.tsx` (holder + `AssignmentTimeline`, reusing the existing `publicGetPosition`).
- **Navigation:** add a People | Positions tab strip to `_public/_layout.tsx` so an authenticated viewer can switch search modes.

## Workstream D — Rate-limit search (item 7)

Add `searchLimiter` to `server/security.ts`, modelled on the existing `authLimiter`:

```
windowMs: 60_000, limit: Number(process.env.SEARCH_RATE_LIMIT) || 15
keyGenerator: createKeyGenerator()   // per-user (now always authed) or per-IP
handler: createRateLimitHandler("search", 15)
```

Mount in `server/app.ts` **before** `generalLimiter`:

- `/api/search-people`, `/api/search-positions` — always limited (they are pure search).
- `/` and `/positions` — limited only when a query is present (`skip: (req) => !req.query.q`), so browsing/pagination chrome isn't throttled by the tight window.

Violations flow through the existing `logRateLimitViolation` path (which itself honours the audit sink from Workstream E).

## Workstream E — Audit logs outside the DB (item 8)

Introduce a sink abstraction so audit events can leave the database.

- **Env:** `AUDIT_SINK` = `stdout` (default) | `db` | `both`. Parsed in `app/utils/config/env.server.ts` (or read directly with a validated default).
- **`writeAudit`** (`app/utils/auth/audit.server.ts`): builds the audit record once, then:
  - `stdout` / `both` → `logger.info({ audit: true, ...record }, "audit")` — a structured pino line an external collector (Loki/CloudWatch) scrapes.
  - `db` / `both` → the existing `prisma.auditLog.create`.
  - Default `stdout` → no DB write.
- **`rate-limit-audit.ts`** `flushRateLimitBuffer`: same branch — emit pino lines for `RATE_LIMIT` events on stdout, keep `createMany` only for `db`/`both`.
- **`.env.example`:** document `AUDIT_SINK` with the default and the tradeoff below.

**Tradeoff (must acknowledge):** the in-app audit-log viewer (`$tenant/logs/*`) reads the `AuditLog` table. Under the default `stdout`, it shows historical rows but no new events. Operators who want the in-app viewer to keep working set `AUDIT_SINK=both`. This is called out in `.env.example` and the phase-09/phase-13 docs.

---

## Testing

- **Unit:** `publicListPositions` (shape + no `tenantId`); `writeAudit` sink routing (stdout vs db vs both) with a mocked logger/prisma; min-length guard.
- **Integration:** positions public helper tenant-isolation invariant (mirrors existing people/org tests); search returns ≤ pageSize.
- **Manual/E2E:** anonymous `/` → redirect to `/login`; authed tenantless user searches people & positions; 3-letter minimum enforced; pagination at 5; 16th search in a minute → 429.

## Out of scope / deferred

- No public **organization** detail/list pages (none exist today; org contact already lives in admin). Not adding them here.
- No seniority-gated visibility for office contacts.
- No external HTTP/SIEM audit transport (stdout only per decision); adding one later is a third sink branch.
- CSV import, migration baseline — unchanged, still deferred.
