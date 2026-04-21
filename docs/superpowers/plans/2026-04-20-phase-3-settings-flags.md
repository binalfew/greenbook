# Phase 3 — Settings + Feature Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce DB-backed settings and feature flags with a scoped resolution model (global / tenant / user), a setting registry for UI rendering, and a per-tenant `/settings` admin shell. `requireFeature(request, flagKey)` gates phase-appropriate features at loader/action time. Business-hours profiles land as a small optional service to exercise the pattern end-to-end.

**Architecture (what arrives in this phase):**

- `SystemSetting`, `FeatureFlag`, `BusinessHoursProfile` Prisma models.
- `app/utils/db/memory-cache.server.ts` — tiny TTL cache reused by feature-flag resolution (and by later phases: rate limit, webhook subscriptions).
- `app/utils/config/settings-registry.ts` — catalogue of every setting the template knows about (label, description, category, type, default). Drives the settings admin UI.
- `app/utils/config/settings.server.ts` — `getSetting`, `setSetting`, `getSettingsByCategory`, `getAllSettings`, `deleteSetting` with scope priority user → tenant → global → registry default.
- `app/utils/config/feature-flags.server.ts` — `FEATURE_FLAG_KEYS`, `isFeatureEnabled(key, context)`, `getAllFlags(context)`, `setFlag(key, updates, ctx)`, `clearFlagCache()`.
- `app/utils/auth/require-auth.server.ts` gains `requireFeature(request, flagKey)` — combines `requireAuth` + tenant null check + `isFeatureEnabled`, throws 404 when disabled.
- `app/services/business-hours.server.ts` — CRUD for `BusinessHoursProfile`.
- `$tenant/settings/` route tree with shell, general settings, feature-flag admin, and business-hours list/detail.
- `$tenant/_layout.tsx` rehydrated to load a curated set of template flags (not the 24-flag FMS set).

**Tech stack touched:** `prisma/schema.prisma`, `prisma/seed.ts`, `app/utils/db/memory-cache.server.ts` (new), `app/utils/config/settings-registry.ts` (new), `app/utils/config/settings.server.ts` (new), `app/utils/config/feature-flags.server.ts` (new), `app/utils/auth/require-auth.server.ts`, `app/services/business-hours.server.ts` (new), `app/routes/$tenant/settings/**` (new), `app/routes/$tenant/_layout.tsx`.

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`
**Reference (READ-ONLY):** `/Users/binalfew/Projects/facilities/` — port-from, not modify-from.
**Working directory:** `/Users/binalfew/Projects/templates/react-router`
**Branch:** `phase-3-settings-flags` off `main` (cut before Task 1).

---

## Hard constraints

- NEVER modify `/Users/binalfew/Projects/facilities`. `Read` only.
- Do NOT seed FMS-specific feature flags (`FF_LOCATIONS`, `FF_ASSETS`, etc.) — those modules don't exist in the template. Ship a curated template-appropriate set.
- Do NOT seed FMS-specific settings (`locations.measurement_unit`, `inventory.*`). Ship only foundational settings (auth, general, upload, email, audit).
- Each task lands green (`typecheck`, `build`) before the next starts.
- Mechanical tasks auto-commit; schema and layout-wiring tasks pause for user approval.
- Commitlint rules carry over (≤100 chars, lowercase conventional prefix, no "API" uppercase).
- Destructive Prisma ops still require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` — new tables are additive, so `--force-reset` shouldn't be needed this phase.

---

## Decisions locked in this phase

| Decision                   | Choice                                                                                                                                                                                       | Rationale                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Setting resolution order   | user → tenant → global → registry default                                                                                                                                                    | Matches facilities. Registry default wins only when nothing is stored for any scope.                                |
| Setting `scope` values     | `"global"`, `"tenant"`, `"user"` (no `"role"`)                                                                                                                                               | Role-scoped settings rarely useful; add later if needed.                                                            |
| FeatureFlag `scope` values | `"global"` (on/off for all tenants, tenant can opt out via `disabledForTenants`) or `"tenant"` (off by default, opt-in via `enabledForTenants` / `enabledForRoles` / `enabledForUsers`).     | Matches facilities. Let template authors decide per-flag which policy fits.                                         |
| Default flag set           | 8 template-appropriate flags (see Task 6)                                                                                                                                                    | Avoid cargo-culting the 24-flag FMS list.                                                                           |
| Default setting set        | ~10 foundational settings across auth/general/upload/email/audit categories                                                                                                                  | Matches what Phase 1 already reads (session timeout, password expiry, etc.).                                        |
| MemoryCache TTL for flags  | 60s                                                                                                                                                                                          | Matches facilities. Admin UI calls `clearFlagCache()` on update so readers see new values within the request cycle. |
| `requireFeature` behaviour | Throws 404 when disabled (not 403)                                                                                                                                                           | A disabled feature should be invisible, not visibly-forbidden. Matches facilities.                                  |
| Settings admin entry point | `/$tenant/settings/` (new layout + sidebar nav)                                                                                                                                              | Mirrors facilities' `$tenant/settings/` tree.                                                                       |
| Business hours             | Part of Phase 3 — small service + admin UI to exercise the setting-adjacent pattern                                                                                                          | Proves the pattern without dragging in SLA/property integration.                                                    |
| RBAC gate                  | Settings routes require permission `settings:read` / `settings:write`; feature-flag routes require `feature-flag:read` / `feature-flag:write`. Seed grants these to the tenant `admin` role. | Phase 1 gave `admin` all listed permissions — new permissions need `bootstrapNewTenant` update.                     |

---

## File-level impact map

### New files

```
prisma/seed/feature-flags.ts               — default FeatureFlag seed data (~40 lines)
app/utils/db/memory-cache.server.ts        — generic TTL cache (~60 lines)
app/utils/config/settings-registry.ts      — template-focused registry (~180 lines)
app/utils/config/settings.server.ts        — getSetting/setSetting/... (~250 lines)
app/utils/config/feature-flags.server.ts   — flag SDK (~180 lines)
app/services/business-hours.server.ts      — CRUD (~180 lines)
app/routes/$tenant/settings/_layout.tsx    — settings shell with sidebar (~80 lines)
app/routes/$tenant/settings/index.tsx      — overview / general settings (~180 lines)
app/routes/$tenant/settings/features.tsx   — flag admin (~260 lines)
app/routes/$tenant/settings/business-hours/index.tsx      — list
app/routes/$tenant/settings/business-hours/new.tsx        — create
app/routes/$tenant/settings/business-hours/$profileId/index.tsx   — detail
app/routes/$tenant/settings/business-hours/$profileId/edit.tsx    — edit
app/routes/$tenant/settings/business-hours/$profileId/delete.tsx  — delete
```

### Modified files

```
prisma/schema.prisma                           — add SystemSetting / FeatureFlag / BusinessHoursProfile + Tenant relations
prisma/seed.ts                                  — seed default flags + a small baseline SystemSetting row (optional) + new permissions
app/utils/auth/require-auth.server.ts           — add requireFeature helper
app/services/tenant-setup.server.ts             — extend TENANT_ADMIN_PERMISSIONS with settings/feature-flag actions
app/routes/$tenant/_layout.tsx                  — load curated flag set + pass enabledFeatures to outlet
```

### Out of scope for Phase 3

- Roles/permissions admin UI under `/$tenant/settings/security/` — Phase 3.5 or Phase 5.
- SSO/OIDC configs — Phase 10.
- i18n registry — Phase 4.
- Webhook subscriptions admin — Phase 6.

---

## Pre-flight

### Task 0: Branch + baseline

- [ ] **Step 1: Confirm clean state.**

  ```bash
  cd /Users/binalfew/Projects/facilities && git status
  cd /Users/binalfew/Projects/templates/react-router && git status && git branch --show-current
  ```

  Expected: facilities clean on `main`; templates clean on `main` with Phase 2 merged.

- [ ] **Step 2: Cut the branch.**

  ```bash
  cd /Users/binalfew/Projects/templates && git checkout -b phase-3-settings-flags
  ```

- [ ] **Step 3: Baseline.**
  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck && npm run build
  ```

---

## Group A — Schema + cache (Tasks 1–2)

### Task 1: Schema — SystemSetting + FeatureFlag + BusinessHoursProfile

**Files:**

- Modify: `prisma/schema.prisma`

**Reference:** facilities `model SystemSetting`, `model FeatureFlag`, `model BusinessHoursProfile`.

- [ ] **Step 1: Add `SystemSetting`.** Port facilities fields: `id`, `tenantId String?`, `key`, `value`, `type String @default("string")`, `category String @default("general")`, `scope String @default("global")`, `scopeId String @default("")`, `lastAccessedAt`, `accessCount Int @default(0)`, timestamps. `@@unique([key, scope, scopeId])`, `@@index([tenantId])`. Relation: `tenant Tenant? @relation(fields: [tenantId], references: [id])`.

- [ ] **Step 2: Add `FeatureFlag`.** Port: `id`, `key @unique`, `description String?`, `scope String @default("tenant")`, `enabled Boolean @default(false)`, `enabledForTenants String[] @default([])`, `disabledForTenants String[] @default([])`, `enabledForRoles String[] @default([])`, `enabledForUsers String[] @default([])`, timestamps.

- [ ] **Step 3: Add `BusinessHoursProfile`.** Port: `id`, `tenantId`, `name`, `timezone String @default("UTC")`, day columns `monday..sunday Json?`, `holidays Json?`, `isDefault Boolean @default(false)`, timestamps. `@@index([tenantId])`. Drop facilities' `slaPolicies`/`properties`/`buildings` relations — those models don't exist.

- [ ] **Step 4: Add back-relations on `Tenant`.** Add `settings SystemSetting[]` and `businessHoursProfiles BusinessHoursProfile[]` to the Tenant model.

- [ ] **Step 5: Push + regenerate + typecheck.**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npx prisma db push --accept-data-loss
  cd /Users/binalfew/Projects/templates/react-router && npx prisma generate
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

- [ ] **Step 6: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add settings + feature flag + business hours models"
  ```

---

### Task 2: MemoryCache utility

**Files:**

- Create: `app/utils/db/memory-cache.server.ts`

**Reference:** facilities' `MemoryCache` (~50 lines).

**API:**

```ts
export class MemoryCache<T> {
  constructor(ttlMs: number);
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  invalidate(key: string): void;
  clear(): void;
}
```

Notes: store `{ value, expiresAt }`; `get` returns `undefined` on miss or expiry (which also deletes the entry). Keep the implementation tiny — no periodic sweep needed for this phase (Phase 13 swaps for Redis).

- [ ] **Step 1: Write the class.**
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add memory cache utility"
  ```

---

## Group B — Settings service + registry (Tasks 3–4)

### Task 3: Settings registry (template-focused)

**Files:**

- Create: `app/utils/config/settings-registry.ts`

**Curated list — template only** (NO inventory/locations/workflow settings):

```
general.app_name                          string   "Template App"
general.default_timezone                  string   "UTC"
auth.session_timeout_minutes              number   480
auth.inactivity_timeout_minutes           number   60
auth.max_failed_attempts                  number   5
auth.lockout_duration_minutes             number   30
auth.password_expiry_days                 number   90
auth.password_history_count               number   5
upload.max_file_size_mb                   number   10
upload.allowed_extensions                 string   "jpg,jpeg,png,gif,pdf,doc,docx"
email.from_address                        string   "noreply@example.com"
email.from_name                           string   "Template App"
audit.retention_years                     number   7
```

Export `SETTINGS_REGISTRY: SettingDefinition[]` and `SETTING_DEFAULTS: Record<string, {value, type, category}>` (the latter derived from the registry — facilities keeps them separate; we derive).

- [ ] **Step 1: Write the registry.**
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add settings registry"
  ```

---

### Task 4: Settings service

**Files:**

- Create: `app/utils/config/settings.server.ts`

**Reference:** facilities `settings.server.ts`.

**API:**

```ts
export interface ResolvedSetting { ... }
export async function getSetting(key: string, ctx?: { userId?: string; tenantId?: string }): Promise<ResolvedSetting | null>;
export async function setSetting(input: UpsertSettingInput, ctx: ServiceContext): Promise<SystemSetting>;
export async function getSettingsByCategory(category: string, ctx?): Promise<ResolvedSetting[]>;
export async function getAllSettings(ctx?): Promise<Record<string, ResolvedSetting[]>>;
export async function deleteSetting(key: string, scope: string, scopeId: string, ctx: ServiceContext): Promise<{ success: boolean }>;
```

Behaviour: scope priority user > tenant > global; falls back to registry default when no DB rows match. Every write emits `CONFIGURE` audit event via `writeAudit`.

- [ ] **Step 1: Write the service.** Define `UpsertSettingInput` type inline (no separate schemas file yet — Phase 4).
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add settings service with scope resolution"
  ```

---

## Group C — Feature flags (Tasks 5–6)

### Task 5: Feature-flag service

**Files:**

- Create: `app/utils/config/feature-flags.server.ts`

**Reference:** facilities `feature-flags.server.ts`.

**Template-curated `FEATURE_FLAG_KEYS`:**

```ts
export const FEATURE_FLAG_KEYS = {
  TWO_FACTOR: "FF_TWO_FACTOR",
  IMPERSONATION: "FF_IMPERSONATION",
  REST_API: "FF_REST_API",
  WEBHOOKS: "FF_WEBHOOKS",
  PWA: "FF_PWA",
  I18N: "FF_I18N",
  SAVED_VIEWS: "FF_SAVED_VIEWS",
  AUDIT_EXPORT: "FF_AUDIT_EXPORT",
} as const;
```

**API:**

```ts
export async function isFeatureEnabled(
  key: string,
  context?: { tenantId?: string; roles?: string[]; userId?: string },
): Promise<boolean>;
export async function getAllFlags(context?): Promise<FlagWithStatus[]>;
export async function setFlag(
  key: string,
  updates: UpdateFlagInput,
  ctx: ServiceContext,
): Promise<FeatureFlag>;
export function clearFlagCache(): void;
```

`evaluateFlag` logic: if `scope === "global"`, on-by-`enabled` unless tenant opted out; if `scope === "tenant"`, off by default, on when tenant/role/user is in the allow list.

- [ ] **Step 1: Write the service.** Wrap `prisma.featureFlag.findUnique` in a `MemoryCache<Flag | null>` with 60s TTL.
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add feature flag service with tenant/role/user rollout"
  ```

---

### Task 6: `requireFeature` helper + seed default flags

**Files:**

- Modify: `app/utils/auth/require-auth.server.ts` — add `requireFeature`.
- Create: `prisma/seed/feature-flags.ts`
- Modify: `prisma/seed.ts` — call the seed helper.

**`requireFeature` behaviour:**

```ts
export async function requireFeature(
  request: Request,
  flagKey: string,
): Promise<{ user: AuthUser; roles: string[]; isSuperAdmin: boolean; tenantId: string }>;
```

- `requireAuth(request)` first.
- `invariantResponse(user.tenantId, "Missing tenant context", { status: 403 })` (template pattern).
- Build `flagContext = { tenantId, roles, userId }` (strip `tenantId` when `isSuperAdmin` so global flags eval against `enabled` rather than `enabledForTenants`).
- `const on = await isFeatureEnabled(flagKey, flagContext)` — if `!on`, `throw data({ error: "Not Found" }, { status: 404 })`.
- Return `{ user, roles: user.roles.map(r => r.name), isSuperAdmin, tenantId }`.

**Seed default flags:**

```ts
const DEFAULT_FLAGS = [
  {
    key: "FF_TWO_FACTOR",
    scope: "global",
    enabled: true,
    description: "Enable 2FA enrolment and enforcement",
  },
  {
    key: "FF_IMPERSONATION",
    scope: "global",
    enabled: true,
    description: "Allow global admins to impersonate tenant users",
  },
  {
    key: "FF_REST_API",
    scope: "tenant",
    enabled: false,
    description: "Expose /api/* REST endpoints for this tenant",
  },
  {
    key: "FF_WEBHOOKS",
    scope: "tenant",
    enabled: false,
    description: "Allow tenant to register webhook subscriptions (Phase 6)",
  },
  {
    key: "FF_PWA",
    scope: "global",
    enabled: false,
    description: "Progressive web app installable shell",
  },
  { key: "FF_I18N", scope: "global", enabled: false, description: "Multi-language UI (Phase 4)" },
  {
    key: "FF_SAVED_VIEWS",
    scope: "tenant",
    enabled: false,
    description: "Per-user saved view filters (Phase 7)",
  },
  {
    key: "FF_AUDIT_EXPORT",
    scope: "tenant",
    enabled: false,
    description: "Export audit log (CSV/JSON)",
  },
];
```

- [ ] **Step 1: Write `requireFeature`** and `invariantResponse` helper if it doesn't already exist (it lives in `remix-utils` for facilities; add a 4-line local replacement if missing).
- [ ] **Step 2: Write seed data + wire into `prisma/seed.ts`** via `prisma.featureFlag.upsert` per entry.
- [ ] **Step 3: Re-run seed.** `npm run db:seed`.
- [ ] **Step 4: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add requireFeature helper + seed default feature flags"
  ```

---

## Group D — Business hours service (Task 7)

### Task 7: `business-hours.server.ts` CRUD

**Files:**

- Create: `app/services/business-hours.server.ts`

**Reference:** facilities `business-hours.server.ts` — strip the SLA/property/building-integration bits.

**API:**

```ts
export async function listBusinessHoursProfiles(tenantId: string): Promise<BusinessHoursProfile[]>;
export async function getBusinessHoursProfile(
  id: string,
  tenantId: string,
): Promise<BusinessHoursProfile | null>;
export async function createBusinessHoursProfile(
  input: CreateInput,
  ctx: TenantServiceContext,
): Promise<BusinessHoursProfile>;
export async function updateBusinessHoursProfile(
  id: string,
  input: UpdateInput,
  ctx: TenantServiceContext,
): Promise<BusinessHoursProfile>;
export async function deleteBusinessHoursProfile(
  id: string,
  ctx: TenantServiceContext,
): Promise<void>;
export async function setDefaultBusinessHoursProfile(
  id: string,
  ctx: TenantServiceContext,
): Promise<void>;
```

`setDefault` uses a transaction: un-set `isDefault` on all tenant profiles, then set the target.

- [ ] **Step 1: Write the service.** Store day columns as `{ start: "09:00", end: "17:00" } | null`.
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add business hours profile service"
  ```

---

## Group E — Settings UI (Tasks 8–10)

### Task 8: `$tenant/settings/_layout.tsx`

**Files:**

- Create: `app/routes/$tenant/settings/_layout.tsx`

Simple sidebar shell: "General", "Features", "Business Hours" links + `<Outlet />`. Loader calls `requirePermission(request, "settings", "read")` and renders the base page frame. No right-side content — that's the child route's job.

- [ ] Write. Typecheck. Commit.
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add tenant settings layout shell"
  ```

---

### Task 9: `$tenant/settings/index.tsx` (general settings)

**Files:**

- Create: `app/routes/$tenant/settings/index.tsx`

Loader: `requirePermission("settings", "read")`; calls `getSettingsByCategory("general", ctx)` and `getSettingsByCategory("auth", ctx)`. Renders a Card per category with each setting as a read-only row. "Edit" button per row navigates to `/$tenant/settings/$key/edit` (simple dialog route — covered in T9 follow-up or punted to a later phase if bandwidth tight).

Minimum viable T9: read-only display of resolved settings. Editing UI can land in T10 as a shared concern.

- [ ] Write + commit:
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add general settings index page"
  ```

---

### Task 10: `$tenant/settings/features.tsx` (flag admin) + settings edit dialogs

**Files:**

- Create: `app/routes/$tenant/settings/features.tsx`
- Create: `app/routes/$tenant/settings/$key.edit.tsx` (dialog route — overlays on index)

**Flag admin behaviour:**

- Loader: `requirePermission("feature-flag", "read")`. Calls `getAllFlags({ tenantId, roles, userId })`. Return `{ flags }`.
- Component: table with columns Key, Description, Scope, Status (evaluated), Toggle. Toggle posts to a fetcher action with `intent=toggle`.
- Action: `requirePermission("feature-flag", "write")`. Read intent (`toggle` / `add-tenant` / `remove-tenant`). Call `setFlag(key, updates, ctx)`.

**Setting edit dialog:**

- Dialog route reads the registry entry for the key, renders the right input type (string/number/boolean/select), posts to an action that calls `setSetting(input, ctx)`.

- [ ] Write + commit:
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add feature flag admin and setting edit dialog"
  ```

---

## Group F — Layout + validation (Tasks 11–12)

### Task 11: Feature-aware `$tenant/_layout.tsx`

**Files:**

- Modify: `app/routes/$tenant/_layout.tsx`

Load the 8 template flags in parallel via `Promise.all`. Pass `enabledFeatures` + `featureFlagKeys` to the outlet. Keep the current tenant-guard behaviour.

- [ ] Write + commit:
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): load feature flags in tenant layout"
  ```

---

### Task 12: Business-hours admin UI

**Files:**

- Create: `app/routes/$tenant/settings/business-hours/index.tsx`
- Create: `app/routes/$tenant/settings/business-hours/new.tsx`
- Create: `app/routes/$tenant/settings/business-hours/$profileId/index.tsx`
- Create: `app/routes/$tenant/settings/business-hours/$profileId/edit.tsx`
- Create: `app/routes/$tenant/settings/business-hours/$profileId/delete.tsx`

Straightforward CRUD list + detail using `business-hours.server.ts`. Day inputs use native `<input type="time">` (the template's DateTimePicker is for full timestamps, not time-of-day — inline the `time` inputs).

- [ ] Write + commit:
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add business hours admin routes"
  ```

---

### Task 13: Final validation + merge decision

- [ ] Facilities `git status` — clean.
- [ ] `npm run typecheck` — pass.
- [ ] `npm run build` — pass.
- [ ] `npm run db:push` — clean.
- [ ] `npm run db:seed` — succeeds with 8 default feature flags.
- [ ] Dev smoke:
  1. Log in as seed admin.
  2. Visit `/system/settings` — see categories render.
  3. Visit `/system/settings/features` — see 8 flags; toggle `FF_REST_API` → refresh `/api/health` → gate behaviour (note: Phase 3 doesn't wire `requireFeature` into `/api/*` yet; verifying flag persistence is enough).
  4. Visit `/system/settings/business-hours` — create a profile; mark default; delete.
- [ ] `git log --oneline main..phase-3-settings-flags` — expect 12–14 commits.
- [ ] Summary + pause for merge decision.

---

## Rollback plan

- Per-task: `git reset --soft HEAD~1` to unstage + fix.
- Phase: `git checkout main && git branch -D phase-3-settings-flags` then recreate from `main`.
- Schema: additive this phase — a failed push can be reversed by removing the offending model and re-pushing. Only use `--force-reset` if unavoidable.

---

## Open questions deferred to per-task decisions

- Role-scoped settings — deferred. Registry only supports global/tenant/user.
- Per-user overridable settings in the UI — Phase 3 shows tenant-level only; a "My preferences" page lands in Phase 5 with the user profile shell.
- Feature-flag audit in the `$tenant/_layout.tsx` loader — evaluating 8 flags per request is fine with the 60s cache; Phase 13 (Redis) may rework the shape.
- Business-hours calculation (is-in-window?) — not needed in Phase 3. Ships in Phase 6 (SLA/scheduling).
