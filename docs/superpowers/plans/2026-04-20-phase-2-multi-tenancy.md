# Phase 2 — Multi-Tenancy Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a tenant-scoped application shell. Every app-facing route lives under `$tenant/`, driven by the tenant's URL slug. Services take a `TenantServiceContext` so RBAC/audit/notifications have a stable tenant boundary. New users can sign up (auto-creates a tenant), existing tenants can invite users via a tokenised email link, and authenticated users land on their tenant's dashboard after login.

**Architecture (what arrives in this phase):**

- `Tenant` gains `slug` (unique), `logoUrl`, `brandTheme`, `subscriptionPlan`, plus an `Invitation` model + `InvitationStatus` enum.
- `app/utils/types.server.ts` exports `ServiceContext` / `TenantServiceContext` / `PaginatedQueryOptions`. `app/utils/request-context.server.ts` exports `buildServiceContext(request, user, tenantId?)` — a single overloaded builder used by every route action.
- `app/utils/tenant.server.ts` exposes `resolveTenant(slug)` — looks a tenant up and throws 404 on miss.
- `app/routes/$tenant/_layout.tsx` guards with `requireAuth`, calls `resolveTenant`, rejects cross-tenant access with 403, and passes the resolved tenant + user to a minimal dashboard shell.
- `app/services/tenants.server.ts` handles tenant CRUD. `app/services/tenant-setup.server.ts` handles fresh-tenant bootstrap (copies baseline roles + permissions into the new tenant). `app/services/invitations.server.ts` handles create/accept/revoke/list invitations.
- Signup now auto-creates a tenant for the new user; login's post-auth redirect targets `/{user.tenantSlug}/`. Invitation acceptance routes through a new `/auth/accept-invite` page that pre-fills the email and joins the inviter's tenant.

**Tech stack touched:** `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/seed/*.ts`, `app/utils/tenant.server.ts` (new), `app/utils/types.server.ts` (new), `app/utils/request-context.server.ts` (new), `app/routes/$tenant/**` (new), `app/services/tenants.server.ts` (new), `app/services/tenant-setup.server.ts` (new), `app/services/invitations.server.ts` (new), `app/routes/_auth/signup.tsx`, `app/routes/_auth/login.tsx`, `app/routes/_auth/2fa-verify.tsx`, `app/routes/_auth/accept-invite.tsx` (new), `app/utils/auth/auth.server.ts`.

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`
**Reference (READ-ONLY):** `/Users/binalfew/Projects/facilities/` — port-from, not modify-from.
**Working directory:** `/Users/binalfew/Projects/templates/react-router`
**Branch:** `phase-2-multi-tenancy` off `main` (create before Task 1).

---

## Hard constraints (apply to every task)

- NEVER modify `/Users/binalfew/Projects/facilities`. `Read` only.
- NEVER copy domain-specific code (Location, Asset, WorkOrder, etc.). The facilities tenant layout loads 24 feature flags — the template's `$tenant/_layout.tsx` only loads what Phase 2 needs (auth + tenant; feature flags arrive in Phase 3).
- Each task lands green (`typecheck`, `build`) before the next starts.
- Commits happen only on explicit user approval. Mechanical tasks auto-commit; schema + signup/login wiring pause for review.
- Every schema change goes through `npx prisma db push --accept-data-loss` and may require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<user consent string>"` on destructive ops.
- Commitlint rules carry over: subject ≤100 chars, lowercase, conventional prefix (`feat`, `chore`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `revert`).

---

## Decisions locked in this phase

| Decision                    | Choice                                                                                                                                 | Rationale                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Role.tenantId`             | Stay **nullable**. GLOBAL roles keep their tenantId pointing at the System tenant from Phase 1.                                        | Phase 1 locked the seed GLOBAL admin role to the System tenant. Tightening schema-required would orphan that row; services enforce scope semantics instead. |
| Signup policy               | Open signup creates a new tenant with the new user as its admin. Invitations add users to existing tenants.                            | Easiest default for a SaaS template. Apps can bolt on invite-only via a feature flag later.                                                                 |
| Tenant slug                 | Auto-generated from tenant name via `slugify(name)` with numeric suffix on collision; editable in tenant settings (Phase 3).           | Matches facilities UX; avoids making the user invent a slug at signup.                                                                                      |
| Tenant-admin role on signup | Auto-create a tenant-scoped `admin` role and assign it to the signing-up user.                                                         | Mirrors facilities; keeps the per-tenant admin distinct from the GLOBAL admin.                                                                              |
| Invitation expiry           | 7 days (`INVITE_EXPIRY_DAYS = 7`)                                                                                                      | Matches facilities default.                                                                                                                                 |
| Invitation token            | 32-byte hex, stored plaintext (unique index).                                                                                          | Matches facilities. Tokens are high-entropy single-use secrets; DB leak exposure is limited by expiry.                                                      |
| Accept-invite UX            | Existing user logged in with matching email → one-click accept. New user → signup form pre-filled with invite email, then auto-accept. | Keeps the invite link monomorphic (one URL regardless of account state).                                                                                    |
| Cross-tenant access         | Reject 403 at `$tenant/_layout.tsx` if `user.tenantId !== tenant.id`. GLOBAL admins bypass this check.                                 | Matches facilities.                                                                                                                                         |
| Post-login redirect         | `/{tenant.slug}/` for tenant users; `/` for GLOBAL admins (who may operate across tenants).                                            | Simpler than facilities which always redirects to tenant. We keep GLOBAL admin usable from `/`.                                                             |

---

## File-level impact map

### New files

```
prisma/seed/invitations.ts                — optional sample invitation (dev-only, gated on DEV_SEED_INVITES env)
app/utils/tenant.server.ts                — resolveTenant(slug) (~20 lines)
app/utils/types.server.ts                 — ServiceContext / TenantServiceContext / PaginatedQueryOptions (~25 lines)
app/utils/request-context.server.ts       — buildServiceContext overloads (~30 lines)
app/services/tenants.server.ts            — Tenant CRUD (~220 lines)
app/services/tenant-setup.server.ts       — bootstrapNewTenant() creates baseline roles + permissions (~120 lines)
app/services/invitations.server.ts        — create/get/accept/revoke/list (~120 lines)
app/routes/$tenant/_layout.tsx            — auth guard + tenant resolution + dashboard shell (~80 lines)
app/routes/$tenant/index.tsx              — dashboard landing (placeholder) (~40 lines)
app/routes/_auth/accept-invite.tsx        — token consume + optional signup (~160 lines)
```

### Modified files

```
prisma/schema.prisma                      — Tenant gains slug/logoUrl/brandTheme/subscriptionPlan; add Invitation + InvitationStatus
prisma/seed.ts                             — give System tenant a slug; refactor to call bootstrap helper where sensible
app/routes/_auth/signup.tsx                — after user create, create a new Tenant + admin role + link user to tenant + slugify name
app/routes/_auth/login.tsx                 — post-auth redirect targets /{tenant.slug}/ for tenant users
app/routes/_auth/2fa-verify.tsx            — same post-auth redirect change
app/utils/auth/auth.server.ts              — signup() accepts tenant seed args (name, slug); returns session + tenantSlug
```

### Out of scope for Phase 2

- Feature flags + `requireFeature` (Phase 3)
- SystemSetting model + admin settings UI (Phase 3)
- Announcements, business-hours profiles (Phase 3)
- Tenant admin UI (list/create/edit) as a settings page — Phase 3
- SSO/OIDC tenant discovery — Phase 10

---

## Pre-flight

### Task 0: Branch + baseline

**Files:** none.

- [ ] **Step 1: Confirm clean state.**

  ```bash
  cd /Users/binalfew/Projects/facilities && git status
  cd /Users/binalfew/Projects/templates/react-router && git status && git branch --show-current
  ```

  Expected: facilities clean on `main`; templates clean on `main` with Phase 1 merged.

- [ ] **Step 2: Cut the branch.**

  ```bash
  cd /Users/binalfew/Projects/templates && git checkout -b phase-2-multi-tenancy
  ```

- [ ] **Step 3: Baseline typecheck + build.**
  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck && npm run build
  ```

---

## Group A — Schema + shared types (Tasks 1–3)

### Task 1: Tenant + Invitation schema

**Files:**

- Modify: `prisma/schema.prisma`

**Reference:** facilities `model Tenant`, `model Invitation`, `enum InvitationStatus`.

- [ ] **Step 1: Extend `Tenant`** — add `slug String @unique @db.VarChar(120)`, `logoUrl String? @db.VarChar(500)`, `brandTheme String @default("") @db.VarChar(50)`, `subscriptionPlan String @default("free") @db.VarChar(50)`. Keep existing `email` / `phone` / address fields. Add `invitations Invitation[]` relation.

- [ ] **Step 2: Add `enum InvitationStatus`** — values `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`.

- [ ] **Step 3: Add `Invitation` model.** Port facilities shape: `id`, `email`, `tenantId`, `roleIds String[]`, `token String @unique`, `status`, `invitedById`, `expiresAt`, `createdAt`. Relations: `tenant Tenant @relation(...)`, `invitedBy User @relation(...)`. Indexes on `token` and `tenantId`.

- [ ] **Step 4: Add `invitationsSent Invitation[]` back-relation** on `User`.

- [ ] **Step 5: Push schema + regenerate client.**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npx prisma db push --accept-data-loss
  cd /Users/binalfew/Projects/templates/react-router && npx prisma generate
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

- [ ] **Step 6: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add tenant slug/brand + invitation model"
  ```

---

### Task 2: Shared types + request context

**Files:**

- Create: `app/utils/types.server.ts`
- Create: `app/utils/request-context.server.ts`

**Reference:** facilities `app/utils/types.server.ts`, `app/utils/request-context.server.ts`.

- [ ] **Step 1: Create `types.server.ts`.** Export `ServiceContext`, `TenantServiceContext`, `PaginatedQueryOptions`. Copy facilities verbatim — these are tiny and stable.

- [ ] **Step 2: Create `request-context.server.ts`.** Overloaded `buildServiceContext(request, user, tenantId?)` returning `ServiceContext` or `TenantServiceContext`. Derive `ipAddress` from `x-forwarded-for` (via `extractClientIp` from `ip-utils.server`) and `userAgent` from the header.

- [ ] **Step 3: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add ServiceContext + buildServiceContext"
  ```

---

### Task 3: Seed update — System tenant slug

**Files:**

- Modify: `prisma/seed.ts`

- [ ] **Step 1: Give the System tenant a slug.** `slug: "system"`. Keep `email`, `phone`, `city`, `state`, `address`.

- [ ] **Step 2: Re-run seed.**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run db:seed
  ```

- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "chore(template): seed system tenant with slug"
  ```

---

## Group B — Tenant routing shell (Tasks 4–5)

### Task 4: `resolveTenant` helper

**Files:**

- Create: `app/utils/tenant.server.ts`

**Reference:** facilities `app/utils/tenant.server.ts` (~18 lines). Port verbatim with `throw data({ error: ... }, { status: 404 })`.

- [ ] **Step 1: Write the helper.**
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add resolveTenant helper"
  ```

---

### Task 5: `$tenant/_layout.tsx` + dashboard stub

**Files:**

- Create: `app/routes/$tenant/_layout.tsx`
- Create: `app/routes/$tenant/index.tsx`

**Strip facilities-specific parts:**

- Remove the 24-flag loading block (feature flags arrive in Phase 3).
- Remove `measurementUnit`, `supportedLangs`, `getUnreadCount`, `listNotifications`, `getActiveAnnouncements` — those are later phases.
- Remove `DashboardLayout` dependency; use a minimal layout (navbar + sidebar placeholder + `<Outlet />`). Phase 3 wires the real dashboard.

**Layout responsibilities:**

1. `const tenant = await resolveTenant(params.tenant)` — 404 on miss.
2. `const { user, roles } = await requireAuth(request)` — 302 to `/login` on miss.
3. If `user.tenantId && user.tenantId !== tenant.id` and user is not a GLOBAL admin → `throw data({ error: "Forbidden" }, { status: 403 })`.
4. Return `{ user, tenant, roles }`.

**Index responsibilities:** render a placeholder "Welcome to {tenant.name}" card. Phase 3 replaces with a real dashboard.

- [ ] **Step 1: Write both routes.**
- [ ] **Step 2: Manual smoke** — seed, run dev, visit `/system` logged in as `admin@example.com` → placeholder renders; visit `/bogus` → 404; log out, visit `/system` → redirect to `/login`.
- [ ] **Step 3: Typecheck + build + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add tenant layout + dashboard stub"
  ```

---

## Group C — Tenant + setup + signup wiring (Tasks 6–8)

### Task 6: `services/tenants.server.ts`

**Files:**

- Create: `app/services/tenants.server.ts`

**API:**

```ts
export async function listTenants(): Promise<Tenant[]>;
export async function listTenantsPaginated(
  options: PaginatedQueryOptions,
): Promise<{ items; meta }>;
export async function getTenantById(id: string): Promise<Tenant | null>;
export async function getTenantBySlug(slug: string): Promise<Tenant | null>;
export async function createTenant(input: CreateTenantInput, ctx: ServiceContext): Promise<Tenant>;
export async function updateTenant(
  id: string,
  input: UpdateTenantInput,
  ctx: TenantServiceContext,
): Promise<Tenant>;
export async function deleteTenant(id: string, ctx: TenantServiceContext): Promise<void>;
export function slugify(name: string): string;
export async function generateUniqueSlug(name: string): Promise<string>;
```

**Notes:**

- `slugify` — lowercase, replace non-alphanumeric with `-`, strip leading/trailing dashes, max 60 chars.
- `generateUniqueSlug` — keeps appending `-2`, `-3`, ... until unique.
- Every write emits an `AuditLog` row via `writeAudit` (action: `TENANT_CREATE`, `TENANT_UPDATE`, `TENANT_DELETE`).

- [ ] **Step 1: Write the service.**
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add tenants service with CRUD + slug generation"
  ```

---

### Task 7: `services/tenant-setup.server.ts`

**Files:**

- Create: `app/services/tenant-setup.server.ts`

**API:**

```ts
export async function bootstrapNewTenant(args: {
  tenantId: string;
  initialAdminUserId: string;
}): Promise<{ adminRoleId: string; userRoleId: string }>;
```

**Behaviour:**

- Creates two `Role` rows under `tenantId`: `admin` (scope `TENANT`, all template permissions) and `user` (scope `TENANT`, baseline `user:read`).
- Creates `RolePermission` rows mirroring the seed definitions from `prisma/seed/roles.ts`.
- Creates a `UserRole` linking the initial admin user to the tenant's `admin` role.

- [ ] **Step 1: Write the service.** Import `SEED_PERMISSIONS` / `SEED_ROLES` from `prisma/seed/*` so the template's canonical role set is the single source of truth.
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add tenant-setup service for bootstrapping new tenants"
  ```

---

### Task 8: Signup creates a tenant + login/2FA redirect to `/{slug}/`

**Files:**

- Modify: `app/utils/auth/auth.server.ts` — signup accepts optional `tenantName`; creates `Tenant` + `User` atomically, calls `bootstrapNewTenant`.
- Modify: `app/routes/_auth/signup.tsx` — add `tenantName` to the form + schema; on success redirect to `/{newTenant.slug}/`.
- Modify: `app/routes/_auth/login.tsx` — post-auth redirect destination is `/{user.tenant.slug}/` for tenant users, `/` for GLOBAL admins.
- Modify: `app/routes/_auth/2fa-verify.tsx` — same redirect logic (replace the `safeRedirect(redirectTo || "/")` default).

**Implementation notes:**

- `signup(...)` in `auth.server.ts` becomes a transaction: create `Tenant` with auto-slug → create `User` with `tenantId` → create `Password` → call `bootstrapNewTenant` → create initial `Session`. Returns `{ session, tenantSlug }`.
- `signup.tsx` form adds a `tenantName` field (required), pre-fills from email local-part if desired. Schema enforces length + uniqueness (service-layer check via `generateUniqueSlug`).
- `login.tsx` action: after `login(...)`, look up `user.tenantId → tenant.slug`. Default post-auth redirect becomes `/{slug}/` when no `redirectTo` is provided.
- Keep `/` accessible for GLOBAL admin — add a small "pick a tenant" card in Phase 3.

- [ ] **Step 1: Write the changes.**
- [ ] **Step 2: Typecheck + build.**
- [ ] **Step 3: Manual smoke** — signup with a fresh email + tenant name → redirected to `/{slug}/`; logout; login → redirected to `/{slug}/`; login as `admin@example.com` (GLOBAL admin) → lands on `/`.
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): signup creates tenant + login lands on tenant slug"
  ```

---

## Group D — Invitation flow (Tasks 9–10)

### Task 9: `services/invitations.server.ts`

**Files:**

- Create: `app/services/invitations.server.ts`

**Reference:** facilities `app/services/invitations.server.ts` (~105 lines).

**API:**

```ts
export async function createInvitation(input, ctx: TenantServiceContext): Promise<Invitation>;
export async function getInvitationByToken(token: string): Promise<InvitationWithTenant | null>;
export async function acceptInvitation(
  token: string,
  userId: string,
  ctx: ServiceContext,
): Promise<Invitation>;
export async function revokeInvitation(id: string, ctx: TenantServiceContext): Promise<Invitation>;
export async function listInvitations(tenantId: string): Promise<Invitation[]>;
```

**Notes:**

- `createInvitation` generates a 32-byte hex token and — if the email module has a template — queues an invitation email. For Phase 2 we log the invite URL to the server console (email templates arrive in Phase 4).
- `acceptInvitation` checks status + expiry, creates `UserRole` rows, flips status to `ACCEPTED`. Writes audit rows on every state change (`INVITATION_SENT`, `INVITATION_ACCEPTED`, `INVITATION_REVOKED`, `INVITATION_EXPIRED`).

- [ ] **Step 1: Write the service.**
- [ ] **Step 2: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add invitations service"
  ```

---

### Task 10: `/auth/accept-invite` route

**Files:**

- Create: `app/routes/_auth/accept-invite.tsx`

**Flow:**

- Loader: read `?token=XXX`. If missing → 400. Fetch invitation; if status !== `PENDING` or expired → render "This invitation is no longer valid".
- If a currently-authenticated user has `email === invitation.email` → show a one-click "Join {tenant.name}" button. Action: `acceptInvitation(token, user.id)` → redirect to `/{tenant.slug}/`.
- If anonymous (no session): render a signup form pre-filled with the invited email (read-only). On submit: create user (no new tenant — join the inviter's tenant), call `acceptInvitation`, sign the user in, redirect to `/{tenant.slug}/`.
- If logged in with a _different_ email: render "You're signed in as X, but this invitation is for Y. [Log out and try again]".

- [ ] **Step 1: Write the route.**
- [ ] **Step 2: Manual smoke** — create an invitation via Prisma Studio, hit `/auth/accept-invite?token=...` while signed out; complete signup; verify the new user appears in `UserRole` for the invited tenant.
- [ ] **Step 3: Typecheck + build + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add accept-invite route"
  ```

---

## Group E — Validation + cleanup (Tasks 11–12)

### Task 11: Cross-tenant access hardening + `toClientUser`

**Files:**

- Modify: `app/utils/auth/require-auth.server.ts` — add `toClientUser(user)` helper (small subset for the dashboard shell).
- Review: `$tenant/_layout.tsx` 403 block — double-check GLOBAL admin bypass works and cannot be fooled by a crafted slug.

- [ ] **Step 1: Add `toClientUser`.** Returns `{ id, email, firstName, lastName, fullName }` — the bare minimum for the UI.
- [ ] **Step 2: Spot-check the 403 path.** Seed a second tenant via Prisma Studio, create a user under it, verify cross-tenant access returns 403. Verify `admin@example.com` (GLOBAL) can still access both.
- [ ] **Step 3: Typecheck + commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add toClientUser + verify cross-tenant guard"
  ```

---

### Task 12: Final validation

- [ ] Facilities `git status` — clean.
- [ ] `npm run typecheck` — pass.
- [ ] `npm run build` — pass.
- [ ] `npm run db:push` on a fresh DB — clean.
- [ ] `npm run db:seed` — succeeds, System tenant has slug `system`.
- [ ] Dev smoke:
  1. Sign up as a new user with tenant name "Demo Corp" → lands on `/demo-corp/`.
  2. Log out, log in as the same user → lands on `/demo-corp/`.
  3. Log out, log in as `admin@example.com` → lands on `/`.
  4. Visit `/demo-corp/` as the GLOBAL admin → 200.
  5. Visit `/bogus/` → 404.
- [ ] Create an invitation via Prisma Studio, open `/auth/accept-invite?token=...` in an incognito window → signup flow completes → user appears in the invited tenant's user list.
- [ ] Phase commit log: `git log --oneline main..phase-2-multi-tenancy` — expect 10–12 commits.
- [ ] Summary + pause for merge decision.

---

## Rollback plan

- Per-task: `git reset --soft HEAD~1` to unstage, fix, retry.
- Phase: `git checkout main && git branch -D phase-2-multi-tenancy` then recreate from `main`.
- Schema: `npm run docker:down && docker compose up -d db && npm run db:push --force-reset && npm run db:seed`.
- Never `git push --force`.

---

## Open questions deferred to per-task decisions

- Signup form UX: one-step (tenant name + email + password together) vs two-step (tenant name first) — start with one-step; revise if it feels cramped.
- Invitation email delivery: Phase 2 logs the URL server-side; Phase 4 brings email templates.
- Reserved slugs: prevent `admin`, `api`, `auth`, `login`, `signup`, `system`, `_health` — add a small deny list in `generateUniqueSlug`.
- Tenant admin UI (list/create/edit/delete in a settings page) — deferred to Phase 3.
