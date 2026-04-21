# Phase 1 — Auth & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the template's authentication and authorization layer up to facilities parity — 2FA, recovery codes, proper RBAC (join tables + scopes), audit log, impersonation, password hardening, and API keys with rate-limit tiers. Phase 1 ships the server-side primitives; UI for admin-facing pieces (API keys management, roles/permissions admin) arrives in Phase 3 alongside the settings layout.

**Architecture:** The template's current Role↔Permission implicit m-n is replaced with explicit `RolePermission` and `UserRole` join tables. A `RoleScope` enum (GLOBAL / TENANT / EVENT) describes role applicability. A request-scoped cache in `require-auth.server.ts` loads a full `AuthUser` once per request for fast subsequent `requirePermission`/`requireRole` calls. Audit events are written synchronously from route actions via a thin `audit.server.ts` helper. 2FA uses TOTP via `@epic-web/totp` against the existing `Verification` model (which gains new `type` values: `2fa` and `2fa-verify`). Recovery codes are hashed-at-rest. API keys carry a `keyHash` + `keyPrefix` split, rate-limit tiers, and IP/origin allowlists.

**Tech stack touched:** `prisma/schema.prisma`, `prisma/seed.ts`, `app/utils/auth/**`, `app/services/**` (new directory), `app/routes/_auth/**`, one new `app/components/impersonation-banner.tsx`, `server/app.ts` (rate-limit middleware), `package.json` (`@epic-web/totp` already installed — reuse).

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`
**Reference (READ-ONLY):** `/Users/binalfew/Projects/facilities/` — port-from, not modify-from.
**Working directory:** `/Users/binalfew/Projects/templates/react-router`
**Branch:** `phase-1-auth-rbac` off `main` (already created).

---

## Hard constraints (apply to every task)

- NEVER modify `/Users/binalfew/Projects/facilities`. It's the reference source; use `Read` only.
- NEVER copy domain-specific code (anything referencing Location, Asset, WorkOrder, Inventory, Vendor, Space, Lease, Project, Compliance, IoT, AI/ML, Industry, Permit, Shift, PhysicalAccess, Workforce, Staff, SLA — exclusion list from the master spec).
- Each task lands green (`typecheck`, `build`, relevant tests) before the next task starts.
- Commits happen only on explicit user approval. Mechanical tasks get auto-approved; schema/RBAC/audit tasks pause for review.
- Every Prisma schema change goes through `npx prisma db push --accept-data-loss` so the dev DB stays in sync. No `migrate dev` in this phase — migrations start being tracked in Phase 2 when multi-tenancy arrives.
- `requireFeature` is NOT in Phase 1 (it needs feature flags from Phase 3). The four helpers shipping are: `requireAuth`, `requirePermission`, `requireRole`, `requireAnyRole`, `requireGlobalAdmin`.

---

## Decisions locked in this phase

| Decision                                 | Choice                                                     | Rationale                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Role tenantId                            | `String?` (nullable)                                       | Phase 2 tightens to required when every route is under `$tenant/`. Nullable now lets GLOBAL roles exist without a tenant. |
| RoleScope enum                           | GLOBAL / TENANT / EVENT                                    | Matches facilities. EVENT is rarely used but harmless.                                                                    |
| UserRole scoping fields                  | keep `eventId`, drop `stepId`                              | `stepId` is domain-specific (facilities workflow). EVENT scope can still use `eventId`.                                   |
| RolePermission `access`                  | `String @default("any")` — values "own" or "any"           | Matches facilities. Use-case: "own" lets a user operate only on records they created.                                     |
| AuditAction enum vs free-string `action` | free-string `action` (matches facilities AuditLog field)   | The `AuditAction` enum isn't used as a model type in facilities; keep it simple.                                          |
| Password history depth                   | 5 (configurable constant)                                  | Matches facilities default.                                                                                               |
| Recovery codes count                     | 8 codes per user                                           | Matches facilities; balances usability and security.                                                                      |
| 2FA algorithm                            | `SHA1`, 6 digits, 30s period                               | TOTP RFC 6238 defaults. Matches facilities.                                                                               |
| API key prefix                           | `tk_` (template key) — 3 chars + underscore                | Facilities uses `fms_`; we pick template-agnostic `tk_`.                                                                  |
| API key hashing                          | bcrypt with cost 10                                        | Matches facilities.                                                                                                       |
| Rate-limit backing                       | In-memory token bucket (phase 13 upgrades to Redis-backed) | Simplest that works for dev; phase 13 swaps the backend.                                                                  |
| Impersonation timeout                    | 30 minutes                                                 | Matches facilities; sensitive flows benefit from a shortish window.                                                       |

---

## File-level impact map

### New files

```
app/utils/auth/audit.server.ts           — writeAudit() helper (~40 lines)
app/utils/auth/ip-utils.server.ts         — getClientIp(), getUserAgent() (~60 lines)
app/utils/auth/require-auth.server.ts     — RBAC helpers (~220 lines)
app/utils/auth/api-auth.server.ts         — API key verification middleware (~120 lines)
app/utils/auth/rate-limit.server.ts       — In-memory token-bucket rate limiter (~100 lines)
app/services/permissions.server.ts        — CRUD + list for Permission (~190 lines)
app/services/roles.server.ts              — CRUD + list + assignment for Role/UserRole (~240 lines)
app/services/audit.server.ts              — Audit event queries + pagination (~80 lines)
app/services/two-factor.server.ts         — 2FA TOTP setup/verify/disable (~130 lines)
app/services/recovery-codes.server.ts     — Generate/verify/list recovery codes (~60 lines)
app/services/api-keys.server.ts           — API key CRUD, rotate, revoke (~400 lines)
app/services/users.server.ts              — Server-side user helpers (~100 lines)
app/routes/_auth/2fa-setup.tsx            — 2FA setup flow with QR code
app/routes/_auth/2fa-verify.tsx           — 2FA challenge during login
app/routes/_auth/2fa-recovery.tsx         — Recovery code entry
app/routes/_auth/change-expired-password.tsx — Forced password change on expiry
app/routes/resources/impersonate.tsx      — Resource route: start/stop impersonation
app/components/impersonation-banner.tsx   — "You are impersonating X" banner
prisma/seed.ts                            — Rewrite: bootstrap system tenant, admin role, default permissions, admin user (replaces existing stub)
```

### Modified files

```
prisma/schema.prisma                       — Role/Permission/RolePermission/UserRole rework, new models, new enums
app/utils/auth/session.server.ts           — Expanded: verified session, 2FA gate, impersonation support (port from facilities ~401 lines)
app/utils/auth/auth.server.ts              — Refactored: login/signup wire into audit + user status (port from facilities ~53 lines — shrunk)
app/utils/auth/verification.server.ts      — Expanded: new 2fa and 2fa-verify types, TOTP integration
app/utils/auth/constants.ts                — Add MAX_PASSWORD_HISTORY, RECOVERY_CODE_COUNT, IMPERSONATION_TIMEOUT_MINUTES, etc.
app/routes/_auth/login.tsx                  — After successful password, redirect to /2fa-verify if 2FA enabled
app/routes/_auth/logout.tsx                 — Write LOGOUT audit event
app/routes/_auth/signup.tsx                 — Write CREATE audit event on user creation
app/root.tsx                                — Render ImpersonationBanner if actingAsUserId in session
server/app.ts                               — Mount rate-limit middleware (scoped to /api/*)
```

### Out of scope for Phase 1

- `$tenant/` route prefix (Phase 2)
- Settings UI (`/$tenant/settings/**`) — Phase 3
- Feature flags / `requireFeature` — Phase 3
- Invitations / `/auth/accept-invite` — Phase 2 (tenant onboarding)
- SSO (OIDC, SAML) — Phase 10
- GDPR/privacy/consent (DataSubjectRequest) — Phase 9
- Saved views / view-filters — Phase 7
- Reference data (Country, Title, Language, Currency) — Phase 8

---

## Pre-flight

### Task 0: Verify clean working state

**Files:** none.

- [ ] **Step 1: Both repos clean, branch confirmed**

  ```bash
  cd /Users/binalfew/Projects/facilities && git status
  cd /Users/binalfew/Projects/templates/react-router && git status && git branch --show-current
  ```

  Expected: facilities clean on `main`; template clean on `phase-1-auth-rbac`. If either is dirty, STOP.

- [ ] **Step 2: Baseline typecheck + build on the new branch**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck && npm run build
  ```

  Must pass. This is our green baseline.

---

## Group A — Schema + seed (Tasks 1–3)

### Task 1: Schema rebuild — RBAC join tables + RoleScope

**Files:**

- Modify: `prisma/schema.prisma`

**Reference (read only, port from):**

- `/Users/binalfew/Projects/facilities/prisma/schema.prisma` — models `Role`, `Permission`, `RolePermission`, `UserRole`, and `enum RoleScope`.

**Changes:**

- Add `enum RoleScope { GLOBAL TENANT EVENT }` to the enums section.
- Rework `Role` model:
  - Keep: `id`, `name`, `description`, `createdAt`, `updatedAt`
  - Remove: `permissions Permission[]` (implicit m-n), `users User[]` (implicit m-n), `deletedAt`, `@@index([deletedAt])`, `@@index([name])`
  - Add: `tenantId String?`, `tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)`, `scope RoleScope @default(TENANT)`
  - Add: `rolePermissions RolePermission[]`, `userRoles UserRole[]`
  - Replace unique: `@@unique([tenantId, name])` — allows same role name across tenants; nullable tenantId lets GLOBAL roles collide only with each other.
- Rework `Permission` model:
  - Keep: `id`, `description`, `createdAt`, `updatedAt`
  - Rename fields for clarity: `action` stays, `entity String` → `resource String`, drop `access String` (access moves to `RolePermission`)
  - Add: `module String @default("system")` — lets modules register their own permissions in later phases
  - Replace the `@@unique([action, entity, access])` with `@@unique([resource, action], name: "resource_action")`
  - Add: `@@index([module])`
  - Remove: `deletedAt` + related index, `roles Role[]` (implicit m-n)
  - Add: `rolePermissions RolePermission[]`
- Add new `RolePermission` model:

  ```prisma
  model RolePermission {
    id           String @id @default(cuid())
    roleId       String
    permissionId String
    access       String @default("any") // "own" | "any"

    role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
    permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

    @@unique([roleId, permissionId])
  }
  ```

- Add new `UserRole` model:

  ```prisma
  model UserRole {
    id      String  @id @default(cuid())
    userId  String
    roleId  String
    eventId String?

    user User @relation(fields: [userId], references: [id], onDelete: Cascade)
    role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

    @@unique([userId, roleId, eventId])
    @@index([userId])
    @@index([roleId])
  }
  ```

  Note: facilities has a `stepId` field too; we drop it (domain-specific to facilities workflow). `@@unique([userId, roleId, eventId])` replaces the implicit m-n uniqueness.

- Modify `User` model:
  - Remove `roles Role[]` (implicit m-n)
  - Add `userRoles UserRole[]`

- [ ] **Step 1: Edit `prisma/schema.prisma`** per the above.

- [ ] **Step 2: Apply to dev DB**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && [ -f .env ] || cp .env.example .env
  cd /Users/binalfew/Projects/templates/react-router && docker compose up -d db && sleep 3
  cd /Users/binalfew/Projects/templates/react-router && npx prisma db push --accept-data-loss --force-reset
  ```

  `--force-reset` wipes and reapplies; acceptable for a fresh template DB. Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Regenerate client**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npx prisma generate
  ```

- [ ] **Step 4: Typecheck fallout**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

  Expected failures — the existing code uses implicit m-n (`user.roles.connect({ name: 'user' })` etc.). Fix surgically in each failing call site by switching to `userRoles: { create: { roleId: ... } }`. Do NOT rewrite service logic; just adapt the Prisma call shape.

  Specifically: `app/utils/auth/auth.server.ts` line ~187 uses `roles: { connect: [{ name: 'user' }] }` in signup. Replace with `userRoles: { create: { role: { connect: { name: 'user' } } } }`.

  `app/utils/auth/permissions.server.ts` uses `where: { ..., roles: { some: { permissions: { some: ... } } } }` — rewrite to `userRoles: { some: { role: { rolePermissions: { some: { permission: { action: ..., resource: ... } } } } } }`.

  `app/utils/auth/auth.server.ts` `getUser()` selects `roles: { select: { permissions: { select: { entity, action, access } } } }` — rewrite to `userRoles: { select: { role: { select: { rolePermissions: { select: { access: true, permission: { select: { resource: true, action: true } } } } } } } }`.

  Any other call site surfaces during typecheck — fix by mirroring the join-table shape.

- [ ] **Step 5: Build verify**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run build
  ```

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): rework RBAC to explicit join tables with RoleScope"
  ```

---

### Task 2: Schema — AuditLog + RecoveryCode + PasswordHistory + ApiKey + enums

**Files:**

- Modify: `prisma/schema.prisma`

**Reference:** Facilities schema models `AuditLog`, `RecoveryCode`, `PasswordHistory`, `ApiKey`, and enums `AuditAction`, `ApiKeyStatus`, `RateLimitTier`.

- [ ] **Step 1: Add enums**

  ```prisma
  enum ApiKeyStatus {
    ACTIVE
    ROTATED
    REVOKED
    EXPIRED
  }

  enum RateLimitTier {
    STANDARD
    ELEVATED
    PREMIUM
    CUSTOM
  }
  ```

  Skip `AuditAction` enum — we use free-string `action` on `AuditLog`, matching facilities' schema.

- [ ] **Step 2: Add `AuditLog` model**

  Port verbatim from facilities. Key fields: `tenantId String?`, `userId String?`, `actingAsUserId String?`, `action String`, `entityType String`, `entityId String?`, `description String?`, `metadata Json?`, `ipAddress String?`, `userAgent String?`, `createdAt DateTime @default(now())`. Include facilities' indexes.

- [ ] **Step 3: Add `RecoveryCode` model**

  Fields: `id`, `userId`, `codeHash String`, `usedAt DateTime?`, `@@index([userId])`, user relation with `onDelete: Cascade`.

  Add `recoveryCodes RecoveryCode[]` to `User` model.

- [ ] **Step 4: Add `PasswordHistory` model**

  Fields: `id`, `userId`, `hash String`, `createdAt`, `@@index([userId, createdAt(sort: Desc)])`, user relation with `onDelete: Cascade`.

  Add `passwordHistory PasswordHistory[]` to `User` model.

- [ ] **Step 5: Add `ApiKey` model**

  Port verbatim from facilities reference. Important: `tenantId String` is required (API keys can't exist without a tenant). Until Phase 2 seeds real tenants, the bootstrap seed creates a system tenant to attach initial keys to. The field `createdBy String` is also required — set to the seed admin user's id.

  Add `apiKeys ApiKey[]` to `Tenant` model.

- [ ] **Step 6: Extend `Verification` model for 2FA**

  Current template already has `Verification` for email verification. Add no new fields; the existing `type String @db.VarChar(50)` already supports new values (`2fa`, `2fa-verify`). We'll use these types in Task 7.

- [ ] **Step 7: Push to DB + regenerate**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npx prisma db push --accept-data-loss
  cd /Users/binalfew/Projects/templates/react-router && npx prisma generate
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck
  ```

- [ ] **Step 8: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add AuditLog + RecoveryCode + PasswordHistory + ApiKey models"
  ```

---

### Task 3: Bootstrap seed

**Files:**

- Overwrite: `prisma/seed.ts` (the existing file is a stub)
- Possibly add: `prisma/seed/permissions.ts`, `prisma/seed/roles.ts` (split by concern)

**Purpose:** After `db push`, running `db seed` must produce a working baseline: one system tenant, canonical permissions, admin + user roles, and one admin user.

**Reference:** Facilities has a rich seed in `prisma/seed/` folder. We copy the **structure** (file splitting, role creation, permission catalog) but **not the data** — facilities seeds FMS-specific permissions (`location:read`, `asset:write`, etc.). Our template ships only foundational permissions (`user:read`, `user:write`, `role:read`, `role:write`, `permission:read`, `audit:read`, `api-key:read`, `api-key:write`, `impersonate:execute`).

- [ ] **Step 1: Add seed dir + module files**

  Create `prisma/seed/permissions.ts` — exports `SEED_PERMISSIONS` array of `{ resource, action, module, description }`.

  Create `prisma/seed/roles.ts` — exports `SEED_ROLES` describing admin + user roles and which permissions each grants.

  Data sketch:

  ```ts
  export const SEED_PERMISSIONS = [
    { resource: "user", action: "read", module: "system", description: "Read user data" },
    { resource: "user", action: "write", module: "system", description: "Create/update users" },
    { resource: "user", action: "delete", module: "system", description: "Delete users" },
    { resource: "role", action: "read", module: "system", description: "Read roles" },
    { resource: "role", action: "write", module: "system", description: "Manage roles" },
    { resource: "permission", action: "read", module: "system", description: "Read permissions" },
    { resource: "audit", action: "read", module: "system", description: "Read audit log" },
    { resource: "api-key", action: "read", module: "system", description: "Read API keys" },
    { resource: "api-key", action: "write", module: "system", description: "Manage API keys" },
    {
      resource: "impersonate",
      action: "execute",
      module: "system",
      description: "Impersonate users",
    },
  ];

  export const SEED_ROLES = [
    {
      name: "admin",
      scope: "GLOBAL" as const,
      description: "System administrator",
      permissions: SEED_PERMISSIONS.map((p) => ({
        resource: p.resource,
        action: p.action,
        access: "any",
      })),
    },
    {
      name: "user",
      scope: "TENANT" as const,
      description: "Standard tenant user",
      permissions: [{ resource: "user", action: "read", access: "own" }],
    },
  ];
  ```

- [ ] **Step 2: Rewrite `prisma/seed.ts`**

  ```ts
  import bcrypt from "bcryptjs";
  import { PrismaPg } from "@prisma/adapter-pg";
  import { PrismaClient } from "../app/generated/prisma/client";
  import "dotenv/config";
  import { SEED_PERMISSIONS } from "./seed/permissions";
  import { SEED_ROLES } from "./seed/roles";

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const SYSTEM_TENANT = {
    name: "System",
    email: "system@template.local",
    phone: "+0000000000",
    city: "—",
    state: "—",
    address: "—",
  };

  const ADMIN_USER = {
    email: "admin@template.local",
    firstName: "Admin",
    lastName: "User",
    password: "Password123!",
  };

  async function main() {
    // 1. Active UserStatus
    const active = await prisma.userStatus.upsert({
      where: { code: "ACTIVE" },
      update: {},
      create: { code: "ACTIVE", name: "Active", isActive: true, order: 1 },
    });

    // 2. System tenant
    const tenant = await prisma.tenant.upsert({
      where: { name: SYSTEM_TENANT.name },
      update: {},
      create: SYSTEM_TENANT,
    });

    // 3. Permissions (upsert by resource_action)
    for (const p of SEED_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { resource_action: { resource: p.resource, action: p.action } },
        update: { description: p.description, module: p.module },
        create: p,
      });
    }

    // 4. Roles + RolePermission
    for (const r of SEED_ROLES) {
      const role = await prisma.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: r.name } },
        update: { description: r.description, scope: r.scope },
        create: { tenantId: tenant.id, name: r.name, scope: r.scope, description: r.description },
      });
      // reset role permissions
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      for (const p of r.permissions) {
        const perm = await prisma.permission.findUnique({
          where: { resource_action: { resource: p.resource, action: p.action } },
        });
        if (perm) {
          await prisma.rolePermission.create({
            data: { roleId: role.id, permissionId: perm.id, access: p.access },
          });
        }
      }
    }

    // 5. Admin user
    const adminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: tenant.id, name: "admin" },
    });
    const hashedPassword = await bcrypt.hash(ADMIN_USER.password, 10);
    await prisma.user.upsert({
      where: { email: ADMIN_USER.email },
      update: {},
      create: {
        email: ADMIN_USER.email,
        firstName: ADMIN_USER.firstName,
        lastName: ADMIN_USER.lastName,
        tenantId: tenant.id,
        userStatusId: active.id,
        password: { create: { hash: hashedPassword } },
        userRoles: { create: { roleId: adminRole.id } },
      },
    });

    console.log(`Seed done. Admin: ${ADMIN_USER.email} / ${ADMIN_USER.password}`);
  }

  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
  ```

- [ ] **Step 3: Run seed**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run db:seed
  ```

  Expected: "Seed done. Admin: admin@template.local / Password123!". If it fails on UserStatus or Tenant fields (e.g., unique constraint), fix the seed data.

- [ ] **Step 4: Verify in Studio (optional smoke check)**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npx prisma studio &
  ```

  (Ctrl+C after eyeballing.) Confirm `Role` rows have tenantId, `Permission` has 10 rows, `RolePermission` links admin role to all 10.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): bootstrap seed — system tenant, admin role, baseline permissions"
  ```

---

## Group B — Core auth utilities (Tasks 4–5)

### Task 4: Port session + audit + ip-utils helpers

**Files:**

- Create: `app/utils/auth/audit.server.ts`
- Create: `app/utils/auth/ip-utils.server.ts`
- Modify: `app/utils/auth/session.server.ts`
- Modify: `app/utils/auth/auth.server.ts`
- Modify: `app/utils/auth/constants.ts`

**Reference (read only):**

- `/Users/binalfew/Projects/facilities/app/utils/auth/audit.server.ts` (~34 lines)
- `/Users/binalfew/Projects/facilities/app/utils/auth/ip-utils.server.ts` (~60 lines)
- `/Users/binalfew/Projects/facilities/app/utils/auth/session.server.ts` (~401 lines)
- `/Users/binalfew/Projects/facilities/app/utils/auth/auth.server.ts` (~53 lines)

**Plan:**

- [ ] **Step 1: `audit.server.ts`** — one exported `writeAudit({ tenantId, userId, actingAsUserId, action, entityType, entityId, description, metadata, request? })` that inserts into `AuditLog`. Pull `ipAddress`/`userAgent` from the request via `ip-utils` when provided. Never throw — audit write failure logs a warning but does not fail the parent action.

- [ ] **Step 2: `ip-utils.server.ts`** — exports `getClientIp(request)` (reads `x-forwarded-for`, `x-real-ip`, falls back to socket), `getUserAgent(request)`, `parseAllowedIps(csv)`, `isIpAllowed(ip, allowlist)`.

- [ ] **Step 3: Expand `session.server.ts`** — port facilities' expanded version. New exports:
  - `getSessionExpirationDate()` (already exists)
  - `getUserId(request)` (exists — keep behavior)
  - `requireUserId(request, { redirectTo? })` (exists — keep)
  - **NEW** `requireUser(request)` — returns the full user with `userRoles.role.rolePermissions.permission` deep-select. Used by `require-auth.server.ts`.
  - **NEW** `requireAnonymous(request)` — if authenticated, redirect to `/`
  - **NEW** `startImpersonation(sessionId, targetUserId)` — writes `actingAsUserId` into session metadata + audit
  - **NEW** `stopImpersonation(sessionId)` — clears `actingAsUserId` + audit
  - **NEW** Helpers: `getActingAsUserId(session)`, `isImpersonating(session)`

  Fingerprint logic (from existing `auth.server.ts`) stays where it is — it's a detail of `verifyUserPassword`.

- [ ] **Step 4: Refactor `auth.server.ts`** — it's currently monolithic (verifyUserPassword + login + signup + logout + getUser + resetPassword). Split so:
  - `auth.server.ts` keeps: `verifyUserPassword`, `getPasswordHash`, `login`, `signup`, `logout`, `resetUserPassword`
  - `getUser()` moves to `app/services/users.server.ts` (created later in Task 6; for now leave it in `auth.server.ts` as a re-export stub)
  - `requireAnonymous` moves to `session.server.ts`

- [ ] **Step 5: `constants.ts` additions**

  ```ts
  export const MAX_PASSWORD_HISTORY = 5;
  export const RECOVERY_CODE_COUNT = 8;
  export const IMPERSONATION_TIMEOUT_MINUTES = 30;
  export const TWO_FA_WINDOW = 30;
  export const TWO_FA_DIGITS = 6;
  export const API_KEY_PREFIX = "tk_";
  ```

- [ ] **Step 6: Verify**

  ```bash
  cd /Users/binalfew/Projects/templates/react-router && npm run typecheck && npm run build
  ```

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): expand session + auth helpers with audit and ip utilities"
  ```

---

### Task 5: require-auth.server.ts — the RBAC helpers

**Files:**

- Create: `app/utils/auth/require-auth.server.ts`

**Reference:** `/Users/binalfew/Projects/facilities/app/utils/auth/require-auth.server.ts` (~221 lines)

**Strip facilities-specific parts:**

- Remove `requireFeature` (needs feature flags — Phase 3)
- Remove any references to `step` / `stepId` (domain-specific)
- Remove any `isSuperAdmin` logic tied to facilities-specific conventions; instead have `requireGlobalAdmin` check for any role with `scope: GLOBAL` and name `admin`.

**Core API to export:**

```ts
export type AuthRole = { id: string; name: string; scope: RoleScope; eventId: string | null };
export type AuthPermission = {
  resource: string;
  action: string;
  access: string;
  roleScope: RoleScope;
  eventId: string | null;
};
export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string | null;
  roles: AuthRole[];
  permissions: AuthPermission[];
};

export async function requireAuth(request: Request): Promise<AuthUser>;
export async function requirePermission(
  request: Request,
  resource: string,
  action: string,
): Promise<AuthUser>;
export async function requireRole(request: Request, roleName: string): Promise<AuthUser>;
export async function requireAnyRole(request: Request, roleNames: string[]): Promise<AuthUser>;
export async function requireGlobalAdmin(request: Request): Promise<AuthUser>;
```

**Implementation notes:**

- Use a `WeakMap<Request, Promise<AuthUser>>` for request-scoped cache, matching facilities.
- `requirePermission` throws `data({ error: "Forbidden", ... }, { status: 403 })` on miss.
- `requireGlobalAdmin` checks `user.roles.some((r) => r.scope === "GLOBAL" && r.name === "admin")`.
- `requirePermission` checks `user.permissions.some((p) => p.resource === resource && p.action === action)`.

- [ ] **Step 1: Write the file**
- [ ] **Step 2: Typecheck + build**
- [ ] **Step 3: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add require-auth helpers (requirePermission/Role/GlobalAdmin)"
  ```

---

## Group C — Integration + audit wiring (Task 6)

### Task 6: Wire audit events into existing auth routes

**Files:**

- Modify: `app/routes/_auth/login.tsx` — write LOGIN audit event on success
- Modify: `app/routes/_auth/logout.tsx` — write LOGOUT audit event
- Modify: `app/routes/_auth/signup.tsx` — write USER_CREATED audit event
- Modify: `app/routes/_auth/reset-password.tsx` — write PASSWORD_RESET audit event
- Modify: `app/utils/auth/auth.server.ts` — where password verification fails N times and account locks, write ACCOUNT_LOCKED audit

Services needed: none new. `writeAudit` from Task 4.

**Action shape:** each route's action calls `writeAudit({ userId, action, entityType: "user", entityId: userId, description, request })` on relevant events.

- [ ] **Step 1: Edit each route** to add the `writeAudit` calls at the right moment (after the DB mutation commits, before `redirect`).
- [ ] **Step 2: Seed smoke test** — `npm run db:seed && npm run dev`, then log in as admin@template.local, check Prisma Studio for a LOGIN audit row.
- [ ] **Step 3: Typecheck + build**
- [ ] **Step 4: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): write audit events for login/logout/signup/reset-password"
  ```

---

## Group D — 2FA + recovery codes (Tasks 7–8)

### Task 7: 2FA — service + setup route + verify route

**Files:**

- Create: `app/services/two-factor.server.ts`
- Create: `app/routes/_auth/2fa-setup.tsx`
- Create: `app/routes/_auth/2fa-verify.tsx`
- Modify: `app/utils/auth/verification.server.ts` — extend to handle `2fa` and `2fa-verify` types (TOTP via `@epic-web/totp`)
- Modify: `app/routes/_auth/login.tsx` — after password success, check if user has 2FA enabled; if yes, redirect to `/2fa-verify` with an unverified session key

**References:**

- `/Users/binalfew/Projects/facilities/app/services/two-factor.server.ts` (~128 lines)
- `/Users/binalfew/Projects/facilities/app/utils/auth/verification.server.ts` (~197 lines)
- `/Users/binalfew/Projects/facilities/app/routes/auth/2fa-setup.tsx`, `2fa-verify.tsx`

**Service API:**

```ts
export async function start2FASetup(userId: string): Promise<{ otpUri: string; qrCodePng: string }>;
export async function verify2FASetup(userId: string, code: string): Promise<boolean>;
export async function verify2FAChallenge(userId: string, code: string): Promise<boolean>;
export async function disable2FA(userId: string): Promise<void>;
export async function is2FAEnabled(userId: string): Promise<boolean>;
```

- [ ] **Step 1: Port `verification.server.ts` expansion** (TOTP generation, secret storage, `prepareVerification`, `requireRecentVerification`).

- [ ] **Step 2: Write `two-factor.server.ts`** — port from facilities, simplify if possible. Use `@epic-web/totp` which is already in deps.

- [ ] **Step 3: `2fa-setup.tsx`** — loader: requireAuth + generate setup secret + QR code; action: verify user's code + finalize (`commit 2fa verification`).

- [ ] **Step 4: `2fa-verify.tsx`** — loader: require unverified-session-id cookie; action: verify code + promote session to verified.

- [ ] **Step 5: `login.tsx` hook** — after valid password, check `is2FAEnabled(userId)`. If true, set unverified-session-id cookie and `throw redirect("/2fa-verify")`. If false, proceed as today.

- [ ] **Step 6: E2E smoke** — manually: seed → login as admin → go to `/2fa-setup` (route is protected behind requireAuth) → scan QR with authenticator app OR use `npx @epic-web/totp --secret <secret>` to generate a code for testing → paste code → confirm enabled.

- [ ] **Step 7: Typecheck + build**

- [ ] **Step 8: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add 2FA (TOTP) setup + verify flow"
  ```

---

### Task 8: Recovery codes

**Files:**

- Create: `app/services/recovery-codes.server.ts`
- Create: `app/routes/_auth/2fa-recovery.tsx`
- Modify: `app/routes/_auth/2fa-setup.tsx` — after successful 2FA setup, generate + show 8 recovery codes (one-time)

**Reference:** `/Users/binalfew/Projects/facilities/app/services/recovery-codes.server.ts` (~57 lines) + `app/routes/auth/2fa-recovery.tsx`.

**Service API:**

```ts
export async function generateRecoveryCodes(userId: string): Promise<string[]>; // returns 8 plaintext codes; stores hashed
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean>; // true if valid + unused; marks used
export async function countRemainingRecoveryCodes(userId: string): Promise<number>;
```

- [ ] Port service.
- [ ] Recovery codes displayed once after 2FA setup — do not persist plaintext anywhere after the setup page renders.
- [ ] `/2fa-recovery` route: user in unverified-session state (came from login with 2FA enabled) can enter a recovery code to complete login. Consumes the code; promotes session.
- [ ] Typecheck + build. Commit.

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add recovery codes for 2FA bypass"
  ```

---

## Group E — Password hardening + impersonation (Tasks 9–10)

### Task 9: Password history + change-expired-password

**Files:**

- Modify: `app/utils/auth/auth.server.ts` — `resetUserPassword` + `signup` write to `PasswordHistory` and enforce no-reuse of last `MAX_PASSWORD_HISTORY` (5) hashes
- Create: `app/routes/_auth/change-expired-password.tsx` — flow shown when `user.password.lastChanged` is older than policy threshold (we'll define 90 days as default, configurable constant)
- Modify: `app/routes/_auth/login.tsx` — after successful password verify, check password age; if expired, redirect to `/change-expired-password` with an unverified-session marker
- Modify: `app/utils/auth/constants.ts` — add `PASSWORD_EXPIRY_DAYS = 90`

**Reference:** Facilities' auth.server.ts for password history logic; `change-expired-password.tsx` route.

- [ ] Port logic.
- [ ] Audit event `PASSWORD_EXPIRED` on forced change.
- [ ] Typecheck + build. Commit.

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): password history + change-expired-password flow"
  ```

---

### Task 10: Impersonation

**Files:**

- Create: `app/routes/resources/impersonate.tsx` — resource route with action that starts/stops impersonation
- Create: `app/components/impersonation-banner.tsx` — sticky banner "You are impersonating <user>. [Stop]"
- Modify: `app/utils/auth/session.server.ts` — already extended in Task 4 with helpers; verify they work
- Modify: `app/root.tsx` — render banner in layout when `actingAsUserId` present
- Modify: `app/routes/_auth/logout.tsx` — stop impersonation on logout

**Rules (from facilities):**

- Only users with `role:scope=GLOBAL` + `name=admin` can start impersonation.
- Impersonation writes two audit rows: `IMPERSONATE_START` (records target), `IMPERSONATE_END` (on explicit stop or timeout).
- Session carries both `userId` (the admin) and `actingAsUserId` (the target). Requests behave as the target.
- After `IMPERSONATION_TIMEOUT_MINUTES` (30), `getUserId` auto-stops impersonation with `IMPERSONATE_TIMEOUT` audit event.

- [ ] **Step 1: Session metadata shape** — `{ fingerprint: string, actingAsUserId?: string, impersonationStartedAt?: string }`.
- [ ] **Step 2: `impersonate.tsx` action** — `intent=start` + `targetUserId` or `intent=stop`. Both require `requireGlobalAdmin`.
- [ ] **Step 3: Banner component** — receives target user name from root loader data.
- [ ] **Step 4: root loader** — if session has `actingAsUserId`, fetch that user's email; pass both to the component.
- [ ] **Step 5: Timeout check** — inside `getUserId`, if impersonation started > 30 min ago, auto-stop + audit.
- [ ] **Step 6: Typecheck + build + manual smoke** — log in as admin, POST to `/resources/impersonate` with `intent=start&targetUserId=<other user id>`, verify banner renders.
- [ ] **Step 7: Commit**

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add impersonation with audit + 30min timeout"
  ```

---

## Group F — API keys + rate limiting (Task 11)

### Task 11: API key service + api-auth helper + rate limiting

**Files:**

- Create: `app/services/api-keys.server.ts` (~400 lines)
- Create: `app/utils/auth/api-auth.server.ts` (~120 lines)
- Create: `app/utils/auth/rate-limit.server.ts` (~100 lines, in-memory token bucket)
- Modify: `server/app.ts` — mount rate-limit middleware scoped to `/api/**`

**Reference:** `/Users/binalfew/Projects/facilities/app/services/api-keys.server.ts`, `app/utils/auth/api-auth.server.ts`.

**Service API (`api-keys.server.ts`):**

```ts
export async function createApiKey(
  tenantId: string,
  createdBy: string,
  data: CreateApiKeyInput,
): Promise<{ key: ApiKey; plaintextKey: string }>;
export async function listApiKeys(tenantId: string): Promise<ApiKey[]>;
export async function getApiKey(id: string, tenantId: string): Promise<ApiKey | null>;
export async function revokeApiKey(id: string, tenantId: string): Promise<void>;
export async function rotateApiKey(
  id: string,
  tenantId: string,
): Promise<{ newKey: ApiKey; plaintextKey: string }>;
export async function verifyApiKey(
  rawKey: string,
): Promise<{ apiKey: ApiKey; tenantId: string } | null>;
```

**api-auth.server.ts API:**

```ts
export async function requireApiKey(
  request: Request,
  requiredPermissions?: string[],
): Promise<{ apiKey: ApiKey; tenantId: string }>;
```

Middleware:

- Pulls key from `Authorization: Bearer tk_xxxxx` header.
- Verifies via `verifyApiKey` (extract prefix → DB lookup → bcrypt compare).
- Checks IP allowlist, origin allowlist, expiry, status.
- Applies rate limit based on `rateLimitTier` — STANDARD=60/min, ELEVATED=600/min, PREMIUM=6000/min, CUSTOM=rateLimitCustom.
- Writes `RATE_LIMIT` audit event on exceeded + returns 429.
- Writes `API_KEY_IP_BLOCKED` audit on IP rejection + returns 403.

**rate-limit.server.ts API:**

```ts
export function checkRateLimit(
  key: string,
  limitPerMinute: number,
): { allowed: boolean; remaining: number; resetAt: Date };
```

In-memory `Map<string, { tokens: number; resetAt: Date }>`. Phase 13 replaces with Redis-backed.

**server/app.ts:**

Add a pre-router middleware that checks if the URL starts with `/api/`, calls `requireApiKey`, and lets through or rejects. Admin UI routes that CREATE/REVOKE API keys use standard session auth (no API key needed); those land in Phase 3.

- [ ] Port + wire up. No admin UI in Phase 1.
- [ ] Write a tiny E2E check: `curl -H "Authorization: Bearer tk_invalid" http://localhost:3000/api/test` returns 401. (You'll need to add a placeholder `/api/test` resource route that returns 204 to exercise the middleware.) Remove the placeholder before commit, OR keep it under `/api/health` as a useful probe.

- [ ] Typecheck + build. Commit.

  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): API keys + api-auth middleware + in-memory rate limiter"
  ```

---

## Task 12: Final validation

No code changes — just audits.

- [ ] Facilities `git status` clean (`nothing to commit`)
- [ ] `npm run typecheck` — pass
- [ ] `npm run build` — pass
- [ ] `npm run db:push` on a fresh DB — clean
- [ ] `npm run db:seed` — seeds successfully
- [ ] `npm run test` — passes (no tests yet; empty set is OK)
- [ ] `npm run dev` — dev server starts; auth routes `/login`, `/signup`, `/forgot-password`, `/2fa-setup` (after login), `/2fa-verify` all respond 200/302
- [ ] Smoke test flow:
  1. Log in as `admin@template.local` / `Password123!`
  2. Navigate to `/2fa-setup`, enable 2FA, store recovery codes
  3. Log out
  4. Log in again — redirected to `/2fa-verify`
  5. Paste TOTP code — complete login
  6. Check `AuditLog` in Studio: multiple rows (LOGIN, LOGOUT, TWO_FACTOR_ENABLE, LOGIN)
- [ ] Commit-hook smoke test — bad commit-msg rejected, good accepted
- [ ] Phase commit log: `git log --oneline main..phase-1-auth-rbac` — ~12 commits
- [ ] Commit-free summary for user; pause for merge decision.

---

## Rollback plan

- Per-task: `git reset --soft HEAD~1` to keep changes staged and fix.
- Phase: `git checkout main && git branch -D phase-1-auth-rbac` then re-create.
- Schema-only: if a schema change breaks the dev DB, `npm run docker:down && docker compose up -d db && npm run db:push --force-reset && npm run db:seed` to rebuild from scratch.
- Never `git push --force` anything.

---

## Open questions deferred to per-task decisions

- Exact password expiry policy (90 days assumed; easy to adjust via `PASSWORD_EXPIRY_DAYS`).
- Whether `/api/health` stays as a permanent endpoint or gets replaced in Phase 13.
- Shape of `CreateApiKeyInput` — determine by reading facilities' service.
