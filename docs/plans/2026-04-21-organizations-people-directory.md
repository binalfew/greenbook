# Greenbook — AU Directory (Organizations + People) Implementation Plan

**Date:** 2026-04-21
**Revision:** v3 (2026-04-21 — public tier is cross-tenant unified; batch approval; dedup/ cross-tenant refs explicitly out of scope)
**Status:** Draft
**Owner:** Binalfew

**References:**

- Reference schema: `docs/backup_20260421192051.sql` (23 tables, PG 17 dump of legacy Greenbook)
- Tree component source to port: `/Users/binalfew/Projects/facilities/app/components/hierarchy-tree.tsx` (generic) + `location-hierarchy-tree.tsx` (consumer wrapper)
- Template conventions: `CLAUDE.md` (all 15 phases), Notes demo entity (`app/services/notes.server.ts`, `app/routes/$tenant/notes/`)

---

## 1. Product Scope

Greenbook is the **AU Commission "Blue Book"** — a searchable directory of:

- **Organizations** — AU, Main Organs, Departments, Offices, Units, arranged as a hierarchy.
- **People** — individuals with honorifics, contact info, nationality (member state), bio.
- **Positions** — formal posts inside an organization (Chairperson, Commissioner, Director…), with an internal reporting chain.
- **Position assignments** — temporal link between a person and a position (who currently holds X vs. who held X in 2020).

**Admin data is tenant-scoped; the public tier is a single unified cross-tenant view.** Each tenant is an editorial unit (its own focal persons, managers, approval queue), but the public surface aggregates approved records from every opted-in tenant into one seamless directory. Visitors never see the word "tenant."

### Audiences & access tiers

| Tier                                      | Who                                                              | Access                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public**                                | Anyone — no login required                                       | **Cross-tenant unified read.** Sees approved records from every tenant that has opted into the public directory. Never sees tenant names or boundaries. |
| **Focal Person** (per-tenant role)        | Authenticated user responsible for their tenant's directory data | Proposes changes via submissions; sees own drafts + pending submissions; sees their **tenant's** published state                                        |
| **Manager** (per-tenant role)             | Authenticated user responsible for their tenant's quality        | Approves / rejects submissions (individually or in bulk) for their tenant; can make direct changes (self-approved); sees all states within their tenant |
| **Tenant Admin** (existing template role) | Tenant owner                                                     | Manages roles, features, users; full access within their tenant                                                                                         |
| **Global Admin** (existing)               | Platform operator                                                | Cross-tenant administration                                                                                                                             |

### Hard constraints (confirmed with product owner)

- A `Person` belongs to **exactly one tenant**; no cross-tenant dedup in MVP. If the same human works across two tenants, they appear as two independent records.
- No cross-tenant foreign keys. A `Position` at Tenant X cannot reference a `Person` or `Organization` at Tenant Y.
- Approval = public. No separate "publish externally" toggle — once a change is approved by a manager and the referenced tenant has opted into the public directory, the record is immediately public.
- Approval can be done **one-by-one or in batches** (multi-select in the queue → single Approve / Reject action).

Out-of-scope for MVP, in-scope for phase 2+: committees, meetings, documents, partners/partnerships, specialized agencies, regional economic communities (RECs), CSV bulk import, diff-aware merge on concurrent edits.

### Primary user stories (MVP)

**Public viewer**

1. Without logging in, I can browse the AU org structure. Because multiple tenants contribute, I see several top-level roots side-by-side (AU Commission, Parliament, PSC, …) — each appears as an independent subtree with no tenant label.
2. Without logging in, I can open a person's profile and see their current position(s), honorific, contact info (public fields only), and bio. I don't see which tenant entered the record.
3. Without logging in, I can search across approved organizations, people, and positions — results span every opted-in tenant without indicating origin.

**Focal Person**

4. I can submit a new organization/person/position/assignment — it is **not** visible to the public until approved.
5. I can submit an edit to an existing record — my edit is not visible to the public until approved; the public continues to see the last-approved version.
6. I can submit a delete request — the record stays public until approved; on approval it is soft-deleted and disappears from public view.
7. I can see the status of my submissions ("Pending", "Approved", "Rejected") and a feed of my recent activity.
8. I can withdraw a pending submission I no longer want reviewed.
9. I cannot submit a new edit against a record that already has a pending change from anyone — I must wait or ask that change to be withdrawn/rejected.

**Manager**

10. I see a queue of pending submissions across all entity types, filtered by type, submitter, and date.
11. For each submission I see a **before → after diff** and can approve, approve-with-edits (phase 2), or reject-with-notes.
12. When I approve a submission, the real record is created/updated/deleted atomically and becomes visible to the public immediately.
13. I can make direct edits without going through the queue; my direct edits are auto-approved and written with `reviewedById = my id, reviewedAt = now, approvalMode = SELF_APPROVED` for audit-trail clarity.
14. I can browse the history of approved/rejected submissions for auditability.

**Tenant Admin**

15. I can assign users to the `focal_person` or `manager` role per tenant.
16. I can toggle `FF_DIRECTORY` and `FF_PUBLIC_DIRECTORY` feature flags per tenant.

### Non-goals (v1)

- No collaborative real-time editing.
- No approval-routing (multi-manager chain, quorum). A single manager's approval publishes.
- No partial approval of a submission (all-or-nothing per submission).
- No authenticated-but-non-focal-person view (users who log in with no directory role see the same as public).
- No per-field permissions.
- No public-write tier (no "suggest an edit" from the public — yet).

---

## 2. Roles, Permissions & Approval Workflow

### 2.1 Role hierarchy

The template already ships **Role** + **Permission** + **UserRole** (Phase 1). We add two new seeded roles per tenant:

| Role code          | Purpose             | Permissions granted (module: `directory`)                                                                                                                                                                                                                                                                |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focal_person`     | Authors submissions | `organization:read`, `person:read`, `position:read`, `position-assignment:read`, `directory-change:submit`, `directory-change:withdraw-own`, `directory-change:read-own`                                                                                                                                 |
| `manager`          | Reviews & publishes | Everything `focal_person` has, **plus** `organization:write`, `person:write`, `position:write`, `position-assignment:write`, `organization:delete`, `person:delete`, `position:delete`, `position-assignment:delete`, `directory-change:read-all`, `directory-change:approve`, `directory-change:reject` |
| `admin` (existing) | Tenant-wide control | Everything a manager has (via the seed's "all permissions" assignment)                                                                                                                                                                                                                                   |

**Public** is _not_ a role — it's the absence of authentication. Loaders on public routes explicitly skip `requireSession` / `requireTenant` and read only published state.

### 2.2 Change request pattern

Every directory mutation — whether performed by a focal person or a manager — creates a **`ChangeRequest`** row. Managers' direct edits create a ChangeRequest that is immediately transitioned to `APPROVED` (self-approved) so the audit trail is uniform.

```
ChangeRequest
├── id, tenantId
├── entityType           ← "organization" | "person" | "position" | "position_assignment"
├── entityId             ← null on CREATE; set to new row's id after approval
├── operation            ← CREATE | UPDATE | DELETE | MOVE (reparent shortcut, an UPDATE variant)
├── payload          Json ← proposed state for CREATE/UPDATE; reason for DELETE
├── status               ← PENDING | APPROVED | REJECTED | WITHDRAWN
├── submittedById, submittedAt
├── reviewedById?, reviewedAt?
├── reviewerNotes?
├── approvalMode         ← REVIEWED (default) | SELF_APPROVED (manager direct-edit)
├── appliedAt?           ← timestamp when the real mutation landed (null if rejected/withdrawn)
└── failureReason?       ← if apply failed post-approval (rare; retried manually)
```

The **real** entity tables (`Organization`, `Person`, `Position`, `PositionAssignment`) always hold the **published** state. No dual-write, no snapshot columns, no draft rows. Public reads query those tables directly, filtered by `deletedAt IS NULL`.

### 2.3 State diagram (per submission)

```
          ┌──────────┐   withdraw (submitter)   ┌───────────┐
          │ PENDING  │ ───────────────────────► │ WITHDRAWN │
          └────┬─────┘                          └───────────┘
               │
     approve   │   reject
     ┌─────────┴──────────┐
     ▼                    ▼
  ┌────────┐          ┌──────────┐
  │APPROVED│          │ REJECTED │
  └───┬────┘          └──────────┘
      │
      │ (applied atomically in same tx)
      ▼
  ┌──────────────────┐
  │ appliedAt SET +  │
  │ entity mutated   │
  └──────────────────┘
```

Terminal states (`APPROVED`, `REJECTED`, `WITHDRAWN`) are immutable — no un-approve, no re-submit-in-place. A rejected or withdrawn submission can be cloned into a new `PENDING` submission by the focal person (carry-forward of payload for fast iteration).

### 2.4 Concurrency rules

- **One PENDING per (entityType, entityId)** — a second submission against the same record while one is pending is rejected with error `PENDING_REQUEST_EXISTS`. UI tells the user to withdraw their prior submission or wait. This includes DELETE requests.
- **CREATE requests have no `entityId`** — they can never collide with other CREATE requests for "the same" record because there is no record yet. Duplicate-detection is left to the manager (they see the queue).
- **MOVE is a flavor of UPDATE** — treated as UPDATE for the collision check. Only one pending MOVE per org.
- **Cross-entity dependencies** — cannot submit a `PositionAssignment` CREATE that references a `Position` or `Person` whose CREATE is still pending. Services validate referenced ids exist in the real tables.

### 2.5 Approval → apply semantics

Approval runs inside a single DB transaction:

1. Re-read the current live entity (if UPDATE/DELETE) for a final consistency check.
2. Apply the operation: `prisma.<entity>.create/update/softDelete(...)` with the payload.
3. Mark the ChangeRequest `status = APPROVED, reviewedAt, reviewedById, appliedAt, reviewerNotes`.
4. Emit domain event `<entity>.<op>` via `emitDomainEvent` (SSE + webhook fan-out). Use the same event names as non-approval writes — downstream consumers don't need to know a change went through review.
5. Write audit log entry via `writeAudit({ action: "APPROVE_CHANGE", entityType: "ChangeRequest", entityId, ... })` plus the standard audit on the affected entity.

If step 2 fails (stale FK, constraint violation discovered at apply time), the whole transaction rolls back — status stays `PENDING` — and the manager sees a toast with the DB error. No partial state.

### 2.6 Admin UX differences by role

- **Public (logged out)** — clean read-only layout, no admin chrome, no "edit" affordances, no pending badges. The whole page is a published snapshot.
- **Focal person** — admin chrome; every editable record shows a **status pill** ("Published", "Pending your review", "Pending another user's review", "Rejected — click to fix"). Edit forms submit to `/api/changes/submit`. A "My submissions" inbox lives at `/$tenant/directory/changes/mine`.
- **Manager** — admin chrome + an **Approvals queue** at `/$tenant/directory/changes` with counts by entity type. Can also edit directly: the same form routes through a different action (`?intent=direct`) that self-approves.

---

## 3. Design Decisions & Key Tradeoffs

| Decision                          | Choice                                                                                                                                                                                                                                             | Rationale                                                                                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public read tier                  | New **unauthenticated, cross-tenant, un-scoped** route tree at `/public/directory/*` + a separate `public-layout.tsx` with no admin chrome. No tenant slug in the URL.                                                                             | Public is a unified view by product requirement. The un-scoped URL makes the invariant obvious: "if a route lives under `/public/` it does not take a `tenantId` anywhere." Admin tenant prefix stays auth-gated and tenant-scoped.                     |
| Public tenant opt-in              | Per-tenant feature flag `FF_PUBLIC_DIRECTORY` controls whether **that tenant's approved data participates in the unified public directory**. A helper `getPublicTenantIds()` resolves the opted-in set; every public query joins against it.       | Tenants should be able to run Greenbook as an internal-only system. The unified public view silently omits any tenant with the flag off. No separate "publish externally per record" toggle — approval + tenant opt-in is sufficient.                   |
| Approval model                    | **`ChangeRequest` queue**, one model handles all entity types, mutations uniform across authors                                                                                                                                                    | Avoids doubling every table with `Published*` shadow copies. Extensible (adding a new entity is "add a case to the apply switch"). Matches the legacy DSR/privacy pattern already in the codebase (Phase 9) — so the review UX is familiar to the user. |
| Manager direct-edit               | Goes through ChangeRequest but auto-approves (`approvalMode = SELF_APPROVED`)                                                                                                                                                                      | Uniform audit trail; one source of truth for "who changed what and when". A manager editing from the normal form + clicking Save is indistinguishable at the DB level from approving their own pending submission.                                      |
| Concurrency                       | One PENDING per (entityType, entityId)                                                                                                                                                                                                             | Simple, predictable. Avoids merge-conflict UX. Edge case ("multiple edits queued up for same record") is rare in practice; if it becomes common we can add an "unstack" flow in phase 2.                                                                |
| Diff rendering                    | Computed server-side at approval-view time: compare `payload` vs current entity state, render field-by-field                                                                                                                                       | Keeps `ChangeRequest.payload` small (only submitted fields). If the record changes between submission and approval, the manager sees a fresh diff.                                                                                                      |
| Create-before-approval references | Disallow in MVP                                                                                                                                                                                                                                    | e.g., can't submit a PositionAssignment CREATE that points at a Position whose CREATE is still pending. Validator rejects with `REFERENCED_RECORD_NOT_PUBLISHED`.                                                                                       |
| Tree DnD                          | **Manager-only**                                                                                                                                                                                                                                   | Focal persons reparent via form with parent-selector → UPDATE ChangeRequest. Tree DnD is a manager-only UX that submits + auto-approves in one step.                                                                                                    |
| Org hierarchy storage             | Self-referencing `parentId` on `Organization`                                                                                                                                                                                                      | Matches legacy SQL; supports arbitrary depth; Prisma-friendly. Depth-capped cycle check in service (like `NoteCategory.assertNoCycle`).                                                                                                                 |
| Person ↔ Position                | Separate `Position` + `PositionAssignment` (not denormalized)                                                                                                                                                                                      | Handles vacancies, reshuffles, multiple holders, history. Legacy SQL proves this shape.                                                                                                                                                                 |
| Temporal tracking                 | `startDate` + nullable `endDate` + computed `isCurrent` on `PositionAssignment`                                                                                                                                                                    | Easy "who holds it now" + "history" queries. `isCurrent` is derived convenience; service sets/clears on write.                                                                                                                                          |
| Tree component                    | Port `react-arborist`-based `HierarchyTree` from facilities as a generic `app/components/hierarchy-tree.tsx`                                                                                                                                       | Single generic engine; Organizations is first consumer. Reusable for any future hierarchy.                                                                                                                                                              |
| Tree data loading                 | Roots eagerly, children lazy-loaded per expand via a resource route                                                                                                                                                                                | Scales to hundreds of orgs without over-fetching. Matches facilities pattern.                                                                                                                                                                           |
| Cycle guard                       | Application-layer — service walks parent chain, depth 32                                                                                                                                                                                           | No Postgres trigger; keeps the template DB-agnostic and errors surface before the write.                                                                                                                                                                |
| Full-text search                  | Postgres `contains` (case-insensitive) first pass; upgrade to `tsvector` in phase 2 if slow                                                                                                                                                        | Template is Prisma + PG; `tsvector` needs raw SQL. Start simple.                                                                                                                                                                                        |
| IDs                               | CUID                                                                                                                                                                                                                                               | Template convention.                                                                                                                                                                                                                                    |
| Multi-tenancy                     | Every new model has `tenantId` + composite indexes                                                                                                                                                                                                 | Template convention.                                                                                                                                                                                                                                    |
| Soft delete                       | `deletedAt DateTime?` on every entity; list queries filter `deletedAt: null`                                                                                                                                                                       | Template convention.                                                                                                                                                                                                                                    |
| Feature flags                     | `FF_DIRECTORY` (admin surface) + `FF_PUBLIC_DIRECTORY` (public surface)                                                                                                                                                                            | Separate flags so a tenant can disable public view while still running the internal directory. Both default on for system tenant.                                                                                                                       |
| Route placement                   | Admin: `$tenant/directory/*` (per-tenant, auth-gated). Public: `public/directory/*` (un-scoped, unauthenticated).                                                                                                                                  | "Directory" is the user-facing noun. Public prefix has no tenant slug because the public surface is cross-tenant by design.                                                                                                                             |
| Batch approval                    | Service exposes `approveChanges(ids, notes?, ctx)` and `rejectChanges(ids, notes, ctx)` alongside the single-id versions. Approval is **per-id atomic** but the batch method loops and collects per-id results (success/failure/already-reviewed). | One DB transaction per change keeps failure isolated — if change #7 fails cycle-check, changes #1–6 still commit. UI surfaces a "5 approved, 1 failed (reason), 0 skipped" summary.                                                                     |

---

## 4. Data Model (Prisma)

All models belong to a tenant. All ids are CUIDs. All have `createdAt`, `updatedAt`, `deletedAt`.

### 4.1 Organization stack (unchanged from v1 except back-relations)

```prisma
model OrganizationType {
  id          String  @id @default(cuid())
  tenantId    String
  name        String
  code        String
  level       Int
  description String?
  sortOrder   Int     @default(0)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant        Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  organizations Organization[]

  @@unique([tenantId, code])
  @@index([tenantId])
}

model Organization {
  id                String    @id @default(cuid())
  tenantId          String
  name              String
  acronym           String?
  typeId            String
  parentId          String?
  description       String?   @db.Text
  mandate           String?   @db.Text
  establishmentDate DateTime? @db.Date
  isActive          Boolean   @default(true)
  website           String?
  email             String?
  phone             String?
  address           String?
  sortOrder         Int       @default(0)
  version           Int       @default(0)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant    Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  type      OrganizationType   @relation(fields: [typeId], references: [id])
  parent    Organization?      @relation("OrgTree", fields: [parentId], references: [id], onDelete: Restrict)
  children  Organization[]     @relation("OrgTree")
  positions Position[]

  @@index([tenantId])
  @@index([tenantId, parentId])
  @@index([tenantId, typeId])
  @@index([name])
  @@index([acronym])
}
```

### 4.2 Person

```prisma
model Person {
  id            String   @id @default(cuid())
  tenantId      String
  firstName     String
  lastName      String
  honorific     String?
  email         String?
  phone         String?
  bio           String?  @db.Text
  photoUrl      String?
  memberStateId String?
  languages     String[]
  version       Int      @default(0)

  // Public visibility controls — editable by focal person, reviewed by manager.
  showEmail   Boolean  @default(false)
  showPhone   Boolean  @default(false)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant      Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  memberState MemberState?         @relation(fields: [memberStateId], references: [id])
  assignments PositionAssignment[]

  @@index([tenantId])
  @@index([tenantId, lastName, firstName])
  @@index([email])
}
```

`showEmail` / `showPhone` default to `false` — public routes filter these contact fields out of the response. Focal person proposes exposing them; manager approves.

### 4.3 Positions & Assignments (same as v1)

```prisma
model PositionType {
  id             String  @id @default(cuid())
  tenantId       String
  name           String
  code           String
  description    String?
  hierarchyLevel Int?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant    Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  positions Position[]

  @@unique([tenantId, code])
  @@index([tenantId])
}

model Position {
  id             String   @id @default(cuid())
  tenantId       String
  organizationId String
  typeId         String
  title          String
  reportsToId    String?
  description    String?  @db.Text
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant       Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  organization Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  type         PositionType         @relation(fields: [typeId], references: [id])
  reportsTo    Position?            @relation("PositionReports", fields: [reportsToId], references: [id], onDelete: SetNull)
  reports      Position[]           @relation("PositionReports")
  assignments  PositionAssignment[]

  @@index([tenantId])
  @@index([tenantId, organizationId])
  @@index([tenantId, typeId])
}

model PositionAssignment {
  id         String    @id @default(cuid())
  tenantId   String
  positionId String
  personId   String
  startDate  DateTime  @db.Date
  endDate    DateTime? @db.Date
  isCurrent  Boolean   @default(true)
  notes      String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  position Position @relation(fields: [positionId], references: [id], onDelete: Cascade)
  person   Person   @relation(fields: [personId], references: [id], onDelete: Restrict)

  @@index([tenantId])
  @@index([tenantId, positionId, isCurrent])
  @@index([tenantId, personId])
  @@index([tenantId, startDate])
}
```

### 4.4 Reference data (unchanged from v1)

`RegionalGroup`, `MemberState`, `MemberStateRegion` — see v1 for shape. Seeded with 5 AU regions + 55 member states.

### 4.5 **NEW: ChangeRequest**

```prisma
enum ChangeOperation {
  CREATE
  UPDATE
  DELETE
  MOVE          // reparent shortcut for Organization — treated as UPDATE for collision check
}

enum ChangeStatus {
  PENDING
  APPROVED
  REJECTED
  WITHDRAWN
}

enum ApprovalMode {
  REVIEWED       // default — submitted by focal person, reviewed by different manager
  SELF_APPROVED  // manager direct-edit: submitted + approved by same user, same instant
}

enum DirectoryEntity {
  ORGANIZATION
  PERSON
  POSITION
  POSITION_ASSIGNMENT
}

model ChangeRequest {
  id             String          @id @default(cuid())
  tenantId       String
  entityType     DirectoryEntity
  entityId       String?         // null on CREATE until approved
  operation      ChangeOperation
  payload        Json            // proposed fields for CREATE/UPDATE; `{ reason }` for DELETE
  status         ChangeStatus    @default(PENDING)
  approvalMode   ApprovalMode    @default(REVIEWED)

  submittedById  String
  submittedAt    DateTime        @default(now())
  reviewedById   String?
  reviewedAt     DateTime?
  reviewerNotes  String?
  appliedAt      DateTime?
  failureReason  String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant      Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  submittedBy User   @relation("ChangeSubmitter", fields: [submittedById], references: [id])
  reviewedBy  User?  @relation("ChangeReviewer", fields: [reviewedById], references: [id])

  @@index([tenantId, status])
  @@index([tenantId, entityType, entityId])
  @@index([tenantId, submittedById])
  @@index([tenantId, status, submittedAt])
}
```

**Partial unique constraint** — one PENDING per (entityType, entityId) — is enforced at the **service** layer for two reasons:

1. Prisma doesn't support partial unique indexes declaratively. It would require a raw SQL migration (`CREATE UNIQUE INDEX ... WHERE status = 'PENDING'`) which we can add during the migration baseline phase later.
2. Service-layer enforcement returns a typed error with a clear message; a DB constraint error would need translation.

We'll add the partial unique index as a belt-and-braces safety once migrations land.

**Tenant back-relations to add** (to the existing `Tenant` model in `prisma/schema.prisma`):

```
organizations         Organization[]
organizationTypes     OrganizationType[]
people                Person[]
positions             Position[]
positionTypes         PositionType[]
positionAssignments   PositionAssignment[]
memberStates          MemberState[]
regionalGroups        RegionalGroup[]
changeRequests        ChangeRequest[]
```

**User back-relations to add** to `User`:

```
submittedChanges      ChangeRequest[] @relation("ChangeSubmitter")
reviewedChanges       ChangeRequest[] @relation("ChangeReviewer")
```

---

## 5. Service Layer

### 5.1 Entity services (Organization / Person / Position / PositionAssignment)

Each of the four entity services exports **read** + **internal write** helpers:

- **Reads (callable from anywhere):** `listX`, `getX`, `listRootX` / tree helpers, etc. All tenant-scoped, all filter `deletedAt: null`.
- **Writes (exported but named `_internal`):** `_applyCreateX(tenantId, payload, ctx)`, `_applyUpdateX(id, tenantId, payload, ctx)`, `_applySoftDeleteX(id, tenantId, ctx)`. These are **called only by the ChangeRequest approval path** — never by route actions directly.

Examples from `organizations.server.ts`:

```
// READ
listRootOrganizations(tenantId): Promise<RootOrg[]>
listOrganizationChildren(parentId, tenantId): Promise<OrgChild[]>
getOrganization(id, tenantId): Promise<OrgDetail>
getOrganizationAncestry(id, tenantId): Promise<OrgAncestor[]>
assertNoCycle(id, candidateParentId, tenantId): Promise<void>   // reused by approval validator

// INTERNAL WRITE — only called by directory-changes.server.ts
_applyCreateOrg(tenantId, payload, ctx): Promise<Organization>
_applyUpdateOrg(id, tenantId, payload, ctx): Promise<Organization>
_applyMoveOrg(id, newParentId, tenantId, ctx): Promise<Organization>
_applySoftDeleteOrg(id, tenantId, ctx): Promise<Organization>
```

The `_` prefix convention flags that these are not general-purpose service methods — consumers go through the ChangeRequest pipeline.

### 5.2 **NEW: `app/services/directory-changes.server.ts`**

This is the workflow engine. Exports:

```
// Submission (focal person and manager-direct-edit)
submitChange(
  { entityType, operation, entityId?, payload },
  ctx: TenantServiceContext
): Promise<ChangeRequest>

// Self-approve shortcut used by manager direct-edit routes
submitAndApply(
  { entityType, operation, entityId?, payload },
  ctx: TenantServiceContext
): Promise<{ change: ChangeRequest; entity: unknown }>

// Review
approveChange(id, { notes? }, ctx): Promise<{ change: ChangeRequest; entity: unknown }>
rejectChange(id, { notes }, ctx): Promise<ChangeRequest>
withdrawChange(id, ctx): Promise<ChangeRequest>  // submitter-only

// Reads
listPendingChanges(tenantId, { page, pageSize, where }): Promise<{ data, total }>
listMyChanges(tenantId, userId, { page, pageSize, where }): Promise<{ data, total }>
listChangeHistory(tenantId, { entityType?, entityId?, page, pageSize }): Promise<{ data, total }>
getChange(id, tenantId): Promise<ChangeRequestDetail>
computeDiff(change): Promise<FieldDiff[]>   // compares payload vs current live entity

// Guards
assertNoPendingConflict(tenantId, entityType, entityId): Promise<void>  // throws PENDING_REQUEST_EXISTS
assertReferencedRecordsPublished(tenantId, entityType, payload): Promise<void>  // throws REFERENCED_RECORD_NOT_PUBLISHED
```

**`submitChange` flow:**

1. Validate payload with the appropriate Zod schema.
2. `assertReferencedRecordsPublished` — resolve any FK ids in payload and verify they exist + aren't soft-deleted.
3. For UPDATE/DELETE/MOVE: `assertNoPendingConflict`.
4. For Organization UPDATE with a new `parentId`: `assertNoCycle`.
5. Insert `ChangeRequest` with status PENDING.
6. Emit domain event `change.submitted` (useful for notifications to managers).
7. Create a `Notification` for every active user in the tenant with role `manager` (via `createNotification`).

**`approveChange` flow (inside a single Prisma `$transaction`):**

1. Load the change; assert status = PENDING.
2. Dispatch on `(entityType, operation)` to the correct `_apply*` method.
3. On success: mark change APPROVED with `reviewedAt`, `reviewedById`, `appliedAt`, `reviewerNotes`, and (for CREATE) `entityId` = new row's id.
4. Emit both the entity-level event (`organization.created`, etc.) and `change.approved`.
5. Notify the submitter (`createNotification` with type `change_approved`).
6. Write audit log: one entry for the change, one for the entity.

**`submitAndApply` flow** = submit with `approvalMode = SELF_APPROVED` → call the same apply logic inline → mark APPROVED in the same tx. Used by manager direct-edit routes.

Error class: `ChangeRequestError` with status + code (`PENDING_REQUEST_EXISTS`, `REFERENCED_RECORD_NOT_PUBLISHED`, `CIRCULAR_PARENT`, `NOT_PENDING`, `NOT_SUBMITTER`).

### 5.3 Domain events

Add to `app/utils/events/webhook-events.ts`:

```
change.submitted
change.approved
change.rejected
change.withdrawn

organization.created | organization.updated | organization.deleted | organization.moved
person.created       | person.updated       | person.deleted
position.created     | position.updated     | position.deleted
position.assigned    | position.ended
```

Entity-level events fire **only on approval** (not submission), so webhook consumers never see un-published state.

### 5.4 Public-read helpers (cross-tenant)

The **only** callers of these are public-tier loaders. They take **no `tenantId` argument** — they aggregate across every tenant whose `FF_PUBLIC_DIRECTORY` flag is on. A shared gate prevents opt-out tenants from leaking:

```
// app/services/public-directory.server.ts — shared gate
getPublicTenantIds(): Promise<string[]>  // cached ~5min; evicted on flag change

// app/services/organizations.server.ts
publicListOrganizationTreeRoots(): Promise<PublicOrgNode[]>      // roots from every public tenant; no tenant labels
publicListOrganizationChildren(parentId): Promise<PublicOrgNode[]>  // children of a given node, filtered to public tenants
publicGetOrganization(id): Promise<PublicOrg>                    // 404 if in an opt-out tenant
publicSearchOrganizations(query): Promise<PublicOrgNode[]>

// app/services/people.server.ts
publicListPeople({ search, memberStateId, regionalGroupId, organizationId? }): Promise<{ data, total }>
publicGetPerson(id): Promise<PublicPerson>   // strips email/phone unless showEmail/showPhone
publicSearchPeople(query): Promise<PublicPerson[]>

// app/services/positions.server.ts
publicGetPosition(id): Promise<PublicPosition>
publicListPositionsForOrganization(organizationId): Promise<PublicPosition[]>
```

**Invariants** (enforced in code review + tests):

1. Every public helper's Prisma `where` includes `tenantId: { in: await getPublicTenantIds() }` **and** `deletedAt: null`.
2. Public helpers never return `tenantId` in their projection — the field is stripped at the service boundary so it can't leak via an API response.
3. Contact fields (`email`, `phone`) are nulled out unless `showEmail` / `showPhone` is true.
4. An integration test seeds two tenants (one opted-in, one opted-out) and asserts the opt-out tenant's records never appear in any public helper's output.

### 5.5 Batch approval / rejection

`directory-changes.server.ts` exports:

```
approveChanges(ids: string[], { notes? }, ctx): Promise<BatchResult>
rejectChanges(ids: string[], { notes }, ctx): Promise<BatchResult>

type BatchResult = {
  succeeded: { id: string; change: ChangeRequest }[];
  failed: { id: string; code: string; message: string }[];
  skipped: { id: string; reason: "NOT_PENDING" | "NOT_FOUND" }[];
};
```

Implementation detail: loop over the ids, call `approveChange` / `rejectChange` per id (each in its own `$transaction`), catch `ChangeRequestError` and accumulate. Never one large transaction — a cycle-check failure on id #7 must not unwind #1–6.

---

## 6. Routes

### 6.1 Admin (authenticated, tenant-scoped)

```
app/routes/$tenant/directory/
  _layout.tsx                                        — shared tabs: Orgs | People | Positions | Changes
  index.tsx                                          — directory home (quick search + KPIs)

  organizations/
    index.tsx                                        — flat list + search + type filter
    tree.tsx                                         — react-arborist tree view
    +shared/
      organization-editor.tsx                        — Form component
      organization-editor.server.tsx                 — Submits to submitChange / submitAndApply
      organization-schema.ts
    new.tsx                                          — re-exports shared action
    $orgId._layout.tsx                               — detail layout
    $orgId.index.tsx                                 — overview + positions list
    $orgId.delete.tsx                                — dialog; submits DELETE change
    $orgId_.edit.tsx                                 — full-page edit

  people/
    index.tsx, new.tsx, $personId._layout.tsx, $personId.index.tsx,
    $personId.delete.tsx, $personId_.edit.tsx,
    +shared/person-editor.(tsx|server.tsx), person-schema.ts

  positions/
    index.tsx, new.tsx, $positionId._layout.tsx, $positionId.index.tsx,
    $positionId.assign.tsx, $positionId.assignments.$assignmentId.end.tsx,
    $positionId.delete.tsx, $positionId_.edit.tsx,
    +shared/position-editor.(tsx|server.tsx), position-schema.ts

  changes/                                           — NEW: approval queue
    _layout.tsx                                      — tabs: Pending (manager) | Mine (focal person) | History
    index.tsx                                        — default: Pending for managers, Mine for focal persons
    mine.tsx                                         — focal person's own submissions
    history.tsx                                      — approved / rejected / withdrawn
    $changeId._layout.tsx                            — detail (2/3 diff + 1/3 metadata)
    $changeId.index.tsx                              — diff + payload viewer + action buttons
    $changeId.approve.tsx                            — dialog; POST approve
    $changeId.reject.tsx                             — dialog; POST reject with required notes
    $changeId.withdraw.tsx                           — dialog; POST withdraw (submitter only)

  api/
    organizations.children.tsx                       — tree lazy-load
    organizations.move.tsx                           — tree DnD (manager only)
    search.tsx                                       — global directory search (admin)
    changes.submit.tsx                               — focal person form target (creates ChangeRequest)
    changes.submit-and-apply.tsx                     — manager direct-edit target (auto-approves)
```

**All loaders + actions call `requireFeature(request, "FF_DIRECTORY")`.** Editor actions dispatch to `submitChange` or `submitAndApply` based on the user's role + an `?intent` query param. Permissions check is in the action, not the loader (so a focal person can _view_ the editor form but not post a direct-apply).

### 6.2 Public (unauthenticated, cross-tenant, un-scoped)

```
app/routes/public.directory/                          — no tenant slug in the URL
  _layout.tsx                                        — public chrome: AU branding, language switcher, search; NO admin nav, NO user menu
  index.tsx                                          — public landing: search + featured orgs / recently added people
  organizations/
    index.tsx                                        — public flat list (aggregated)
    tree.tsx                                         — public read-only tree (multiple tenant roots rendered as peer top-level nodes, no tenant labels)
    $orgId.tsx                                       — public org detail
  people/
    index.tsx                                        — public list + filters (member state, region, current organization)
    $personId.tsx                                    — public profile
  positions/
    $positionId.tsx                                  — public position detail (current holder + brief history)
  api/
    organizations.children.tsx                       — public lazy-load for the tree
    search.tsx                                       — public unified search (orgs + people + positions)
```

- Layout file `public-layout.tsx`: AU logo (not tenant-specific), language switcher, global search box, footer. No "signed in as" affordances. No tenant name visible anywhere.
- Loaders **do not** call `requireSession` or `resolveTenant`. They go straight to the `public*` service helpers, which internally apply the `getPublicTenantIds()` gate.
- No per-request feature-flag check — the gate is inside `getPublicTenantIds()`. If no tenants have `FF_PUBLIC_DIRECTORY` enabled, every public loader returns empty results + a generic "No directory entries are public yet" empty state.
- Responses have caching headers (`Cache-Control: public, max-age=60, stale-while-revalidate=300`). Public tree roots may cache longer (~5 minutes).
- `robots.txt` at the root allows `/public/directory/*`; `sitemap.xml` is phase 2.

The **URL prefix is `/public/`** (no slug). Middleware can apply different rate-limit buckets to `/public/*` vs `/$tenant/*`.

### 6.3 Admin (changes queue — with batch actions)

```
$tenant/directory/changes/
  _layout.tsx                                        — tabs: Pending (manager) | Mine (focal person) | History
  index.tsx                                          — default: Pending for managers, Mine for focal persons
  mine.tsx
  history.tsx
  $changeId._layout.tsx
  $changeId.index.tsx                                — diff + action buttons (approve, reject, withdraw)
  $changeId.approve.tsx                              — dialog; POST approve
  $changeId.reject.tsx                               — dialog; POST reject with required notes
  $changeId.withdraw.tsx                             — dialog; POST withdraw (submitter only)
  batch-approve.tsx                                  — POST: { ids: string[], notes? } → BatchResult
  batch-reject.tsx                                   — POST: { ids: string[], notes } → BatchResult
```

The queue `index.tsx` uses the template's `DataTable` selectable-rows feature + a toolbar action "Approve selected" / "Reject selected" that POSTs to the batch routes. The response renders a toast summarising `{succeeded.length} approved, {failed.length} failed, {skipped.length} skipped` with a "View failures" link to a side drawer.

### 6.4 Middleware changes

Add a new check in `$tenant/_layout.tsx` loader: if user is authenticated but has **no** directory role (`focal_person`, `manager`, `admin`, or platform-level), they see the tenant directory as read-only — the same tenant-scoped data a focal person would see, just without submit affordances. This is distinct from the public tier (which is cross-tenant and strips tenancy). Logged-in users always see their own tenant's data in the admin chrome, even if they have no edit rights.

---

## 7. Components to Port / Build

### 7.1 Ported from facilities

1. **`app/components/hierarchy-tree.tsx`** — generic engine (~600 lines). Adaptations:
   - Update imports to Greenbook `~/components/ui/*`.
   - Swap facilities' shadcn Toast for Greenbook's **sonner** `toast`.
   - Keep lazy-load queue, search, breadcrumb, DnD, undo.
   - Add a new prop `readOnly?: boolean` — when true, disables DnD, context menus, "+ New" buttons. Used by the public tree.
2. **`app/components/organization-hierarchy-tree.tsx`** — consumer wrapper (~60 lines).

### 7.2 New

3. `app/components/directory/assignment-timeline.tsx` — vertical timeline of assignments; reused by person + position detail pages.
4. `app/components/directory/org-breadcrumb.tsx` — ancestor chain.
5. `app/components/directory/person-card.tsx` — compact profile block.
6. `app/components/directory/change-status-pill.tsx` — "Published", "Pending review", "Rejected", etc. Renders on every editable entity in admin views.
7. `app/components/directory/change-diff.tsx` — side-by-side or unified diff renderer for the approval queue. Driven by `computeDiff(change)` output.
8. `app/components/directory/change-queue-table.tsx` — DataTable-based list view for pending / mine / history.
9. `app/components/public/public-layout.tsx` — public-site chrome.
10. `app/components/public/public-search.tsx` — the public search box.

### 7.3 Dependencies to add

```
npm i react-arborist@^3.4.3 use-resize-observer@^9.1.0
```

No diff library needed — we'll hand-roll the field-level diff since the payload shape is known; avoids another dep.

---

## 8. Schemas (Zod)

`app/utils/schemas/directory.ts`:

```ts
// Entity payloads — used both by editor forms and by ChangeRequest.payload validation
export const organizationPayloadSchema = z.object({ ... });
export const personPayloadSchema = z.object({ ... });
export const positionPayloadSchema = z.object({ ... });
export const positionAssignmentPayloadSchema = z.object({ ... });

// Submission envelopes (the actual form submission shape)
export const submitChangeSchema = z.object({
  entityType: z.enum(["ORGANIZATION", "PERSON", "POSITION", "POSITION_ASSIGNMENT"]),
  operation: z.enum(["CREATE", "UPDATE", "DELETE", "MOVE"]),
  entityId: z.string().cuid().optional(),
  payload: z.unknown(), // refined per entityType at runtime
});

// Review submissions
export const approveChangeSchema = z.object({
  notes: z.string().max(2000).optional(),
});
export const rejectChangeSchema = z.object({
  notes: z.string().min(1, "A reason is required").max(2000),
});
```

The submission schema uses `z.unknown()` for payload at top level and re-validates per `entityType` inside the service — lets one HTTP endpoint handle all four entity types uniformly.

---

## 9. RBAC, Feature Flags, i18n, Navigation

### 9.1 Permissions

Added to `UNIQUE_PERMISSIONS` in `prisma/seed.ts`, module `directory`:

```
organization:read organization:write organization:delete
person:read person:write person:delete
position:read position:write position:delete
position-assignment:read position-assignment:write position-assignment:delete
directory-change:submit
directory-change:withdraw-own
directory-change:read-own
directory-change:read-all
directory-change:approve
directory-change:reject
```

### 9.2 Roles (seeded per tenant)

```
focal_person
  → organization:read, person:read, position:read, position-assignment:read
  → directory-change:{submit, withdraw-own, read-own}

manager
  → (all focal_person perms)
  → organization:{write,delete}, person:{write,delete}, position:{write,delete}, position-assignment:{write,delete}
  → directory-change:{read-all, approve, reject}

admin (existing; seed already gives all permissions)
```

### 9.3 Feature flags

- `FF_DIRECTORY` — default **on** for system tenant. Gates the `/$tenant/directory/*` admin surface.
- `FF_PUBLIC_DIRECTORY` — default **on** for system tenant. **Opts the tenant into the unified public directory.** When off, the tenant's approved records are silently excluded from `/public/directory/*` listings; when on, they participate. This is per-tenant, not global — the public directory is always reachable; it just becomes empty if every tenant opts out.

Both registered in `FEATURE_FLAG_KEYS` and seeded with default values.

### 9.4 i18n

New namespaces:

- `directory` (~100 keys) — all admin screens
- `directory-public` (~40 keys) — public tier UI (kept separate so we can translate marketing-style public copy differently from internal admin copy)
- `changes` (~50 keys) — approval queue, diff labels, status pills

All registered in `app/utils/i18n.ts`; en + fr shipped.

### 9.5 Navigation

Two changes to `app/config/navigation.ts`:

1. Add a new "Directory" group for the admin sidebar (for users with directory permissions):

```
{
  title: "Directory",
  tKey: "directory",
  children: [
    { title: "Organization Tree", tKey: "orgTree",   url: `${basePrefix}/directory/organizations/tree`, featureFlag: "FF_DIRECTORY" },
    { title: "Organizations",     tKey: "orgs",      url: `${basePrefix}/directory/organizations`,      featureFlag: "FF_DIRECTORY" },
    { title: "People",            tKey: "people",    url: `${basePrefix}/directory/people`,             featureFlag: "FF_DIRECTORY" },
    { title: "Positions",         tKey: "positions", url: `${basePrefix}/directory/positions`,          featureFlag: "FF_DIRECTORY" },
    { title: "Approvals",         tKey: "approvals", url: `${basePrefix}/directory/changes`,            featureFlag: "FF_DIRECTORY",
      permission: "directory-change:read-all" },  // managers only; focal persons see "My Submissions" link instead
    { title: "My Submissions",    tKey: "mySubs",    url: `${basePrefix}/directory/changes/mine`,       featureFlag: "FF_DIRECTORY",
      permission: "directory-change:submit" },
  ],
}
```

2. Add a public-facing link in the tenant top-nav's user menu (or footer) — "View public directory" → `/public/directory` — only rendered when the tenant has `FF_PUBLIC_DIRECTORY` on (a nudge so operators see how their contributions appear externally).

---

## 10. Seeding

`prisma/seed.ts` gains `seedDirectory(tenantId)`:

1. **Roles:** upsert `focal_person` + `manager` per tenant. Attach the permission sets above.
2. **Reference data:** `OrganizationType` (5 rows), `PositionType` (10), `RegionalGroup` (5), `MemberState` (55 with region assignments).
3. **Starter org tree:** small AU tree (AU → Commission → a couple of Offices + 8 Departments).
4. **Demo users:** seed three users per tenant for development — one focal person (`focal@...`), one manager (`manager@...`), one public-browsing guest is n/a since public is anon. Assign roles via `UserRole`.
5. Skip sample people/positions — let users populate through the UI to exercise the approval flow.

---

## 11. Testing

Follow the Phase 12 harness.

- **Unit**
  - `assertNoCycle` depth + cycle detection (org service)
  - `assertReferencedRecordsPublished` (directory-changes service) for each entity type
  - `computeDiff` output shape
- **Integration**
  - CRUD round-trip via submit-and-approve path (Organization + Person + Position + Assignment)
  - Pending-conflict guard (second submission against same record rejected)
  - Withdraw path (focal person can, non-submitter can't)
  - Approve path (manager can, focal person can't)
  - Self-approve path (manager direct-edit writes SELF_APPROVED + applies atomically)
  - Reject + re-submit path
  - Cycle guard surfaces at submit time (not apply time) for org MOVE
  - Soft-delete visibility (public reads filter deletedAt)
  - Tenant isolation in admin (two tenants' admin queues invisible to each other)
  - **Cross-tenant public aggregation:** seed two tenants, both opted-in → public list returns records from both, without `tenantId` in responses
  - **Public opt-out gate:** same two-tenant seed but flip tenant B's `FF_PUBLIC_DIRECTORY` off → public helpers return only tenant A's records
  - Public read helpers strip PII by default
  - Batch approve succeeds on 5, fails on 1 (cycle check), skips 1 (already approved) — summary shape correct, DB state matches
- **E2E**
  - Login as focal person (tenant A) → submit create org → logout → login as manager (tenant A) → approve → logout → visit `/public/directory/organizations/tree` → see the new org appear among the roots (no tenant label visible).
  - Login as focal person (tenant A) → submit three edits → login as manager (tenant A) → select all three → batch approve → visit public to see all three live.
  - Login as focal person → edit person → assert status pill shows "Pending"; switch to a manager browser → reject with notes → verify focal person sees "Rejected".

Target 80% on new services.

---

## 12. Phasing

### Phase A — Schema + services + change-request engine (2–3 days)

1. Add Prisma models incl. `ChangeRequest` + enums + back-relations. `prisma db push`.
2. Write entity services with `_apply*` writes (not exposed to routes).
3. Write `directory-changes.server.ts` with submit / approve / reject / withdraw / read helpers + diff + guards.
4. Seed roles, permissions, feature flags, reference data, starter org tree, demo users.
5. Integration tests: submit → approve → public-visible round trip; collision; cycle; withdraw; reject.

### Phase B — Admin CRUD via ChangeRequest (3 days)

6. `app/utils/schemas/directory.ts` — entity payload + submission schemas.
7. Build admin routes for Organization list + new + detail + edit + delete — all routed through `submitChange` / `submitAndApply`.
8. Same for Person + Position + Assignment.
9. Build change-request screens (pending queue, my submissions, history, change detail with diff + approve/reject/withdraw dialogs).
10. Status pills on every editable entity admin view.

### Phase C — Tree component (1–2 days)

11. Install `react-arborist` + `use-resize-observer`.
12. Port `hierarchy-tree.tsx` with `readOnly` prop + sonner swap.
13. Build `organization-hierarchy-tree.tsx` wrapper + node renderer.
14. Admin `organizations/tree.tsx` + resource routes (`organizations.children`, `organizations.move`).
15. DnD (manager-only) with self-approve intent.

### Phase D — Public tier (1–2 days)

16. Add `public-layout.tsx` + `public-search.tsx`.
17. `/public/$tenantSlug/directory/*` routes (tree, orgs, people, positions, search).
18. PII stripping via `public*` service helpers.
19. Cache headers + robots.txt allow rules for public paths.
20. Light E2E smoke: public page loads without session.

### Phase E — Polish & data (1 day)

21. Assignment timeline component on person + position detail pages.
22. Notifications: manager gets notified on `change.submitted`; submitter gets notified on `change.approved` / `rejected`.
23. i18n copy pass (en + fr) across all three namespaces.
24. CLAUDE.md update: add a "Directory + Editorial Workflow" subsystem section.

### Phase F — Deferred (post-MVP)

- CSV bulk import (new column "Import" alongside "+ New").
- `tsvector`-based full-text search + Postgres trigger.
- Approval-with-edits flow (manager tweaks the payload before approving).
- Multi-step approval (two-manager quorum).
- Materialized view for org tree at > 1k nodes.
- Committees / meetings / documents / partners / specialized agencies / RECs.
- Audit-view of "state of the directory at date X" (time-travel query).
- Sitemap.xml + public-page SEO polish.

---

## 13. Risks & Mitigations

| Risk                                                                                                | Mitigation                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focal person submits edit, manager approves stale-view data (record changed underneath them)        | Approval path re-reads the live entity inside the tx; if the current entity state differs in a conflicting way, reject approval with `STALE_PAYLOAD` and show a refreshed diff.                                                                                              |
| Two pending submissions on the same entity in a race                                                | Service-layer check + (later) partial unique DB index. If the check passes due to a race, the second submit fails at insert time via a follow-up query.                                                                                                                      |
| Public tier leaks PII                                                                               | `public*` service helpers are the **only** code path for public loaders; reviewed explicitly at code-review time. Integration tests assert default-false on `showEmail` / `showPhone` strip the fields.                                                                      |
| Public helper accidentally omits the `getPublicTenantIds()` gate                                    | Enforce with (a) an integration test per helper that seeds opt-in + opt-out tenants and asserts the opt-out tenant never appears; (b) a lint-style convention — all public helpers live in functions prefixed `public*` and the gate call is on the first line of every one. |
| Public route leaks `tenantId` in a response body                                                    | Service-boundary projection strips `tenantId` explicitly; public response shapes are typed with a `PublicOrg`/`PublicPerson`/etc. types that have no `tenantId` field. Typechecker catches accidental spread.                                                                |
| Public routes rate-abused by scrapers                                                               | `public/*` paths mounted with the `generalLimiter` at a tighter bucket (e.g., 60 req/min/IP); optional CAPTCHA on search endpoint later.                                                                                                                                     |
| Batch approval's per-id transaction loop is slow for large batches                                  | Approve-in-batches-of-50 with a progress indicator; UI disables inputs while processing. At scale, a background job would own this, but 50-at-a-time is plenty for the review workflow.                                                                                      |
| Manager direct-edit bypasses audit trail                                                            | Self-approved ChangeRequest IS the audit trail — the approvalMode column lets queries separate self-approvals from reviewed approvals.                                                                                                                                       |
| Approval UI overwhelms manager with noise                                                           | Queue tabs filter by entity type + submitter; pending counts in nav badge; notifications throttle to one per manager per minute.                                                                                                                                             |
| Creating org tree via submissions is slow for initial setup                                         | Seed the starter tree directly in the DB; a bulk-submit path with auto-approve is a phase-F tool.                                                                                                                                                                            |
| Change to referenced entity (e.g., rename an Org) after a dependent submission was made             | Approval path re-resolves FK ids; if referenced record is gone/soft-deleted, approval fails with `REFERENCED_RECORD_NOT_PUBLISHED`.                                                                                                                                          |
| Webhook consumers get both `change.approved` + `organization.created` for the same effective change | This is intentional — the two events serve different consumers (workflow tools vs. directory-mirroring integrations). Document in webhook catalog.                                                                                                                           |
| `react-arborist` + React 19 compat                                                                  | v3.4.3 supports React 18/19; pin version; smoke-test in dev before committing the tree.                                                                                                                                                                                      |

---

## 14. Resolved Product Decisions

### From product owner (2026-04-21)

1. **Public access tier:** Cross-tenant unified view. Visitors never see tenant names or boundaries. URL: `/public/directory/*` (no slug).
2. **Person cardinality:** A person belongs to exactly one tenant. No cross-tenant dedup in MVP.
3. **Cross-tenant references:** Forbidden. Every entity's FKs stay within its own tenant.
4. **Approval → public:** Automatic. An approved record in an opted-in tenant is immediately public. No separate "publish externally" toggle per record.
5. **Batch approval:** Supported, per-id atomic (one failing id doesn't unwind the rest).
6. **Public locale:** Respects the browser's language / `lngs` query param. Does not read any per-tenant setting.

### Judgment calls confirmed (2026-04-21)

7. **Dual role (focal_person + manager on the same user):** Allowed. The `approvalMode` column distinguishes self-approved from reviewed approvals in the audit trail. UI shows both the approvals queue and the submissions inbox.
8. **Withdraw ownership:** Only the submitter can withdraw. Managers reject instead of withdrawing other people's submissions — preserves clear ownership.
9. **Resubmit after reject:** Allowed. The "Cloned from" pointer on the new submission lets managers see history.
10. **Ending a current assignment:** Goes through the approval queue like every other mutation. Ending someone's tenure is a visible public change and deserves review.
11. **Tree DnD for focal persons:** **Deferred.** MVP: tree DnD is manager-only (self-approved MOVE). A "propose move" DnD with a pending overlay is a later polish.
12. **Public empty state with zero opted-in tenants:** Generic message ("The public directory is not yet available"); doesn't reveal the opt-in gate.
13. **Sitemap / SEO:** Phase 2. MVP ships `robots.txt` allowing `/public/directory/*`.
14. **Manager's "preview my tenant in public" filter:** Phase E polish, not MVP. A manager can always browse `/public/directory/*` directly; a "my tenant only" facet is nice-to-have.

---

## 16. Definition of Done (MVP)

- [ ] Prisma schema applied with `ChangeRequest` + enums + all entity models; `db push` green.
- [ ] All four entity services + `directory-changes.server.ts` pass integration tests; coverage ≥ 80%.
- [ ] `focal_person` + `manager` roles seeded; permissions correctly gated in all loaders + actions.
- [ ] Admin tree renders seeded org tree; manager DnD + undo works; focal person cannot DnD.
- [ ] Full CRUD on Organization / Person / Position / PositionAssignment, all routed through the ChangeRequest pipeline.
- [ ] Approvals queue: manager can see pending + approve / reject with notes, **single or batch**.
- [ ] Submissions inbox: focal person can see own pending / approved / rejected / withdrawn.
- [ ] Public tree + list + detail renders at `/public/directory/*` (no tenant slug) without auth; only approved data from opted-in tenants visible; no `tenantId` or tenant name leaks anywhere in the response; PII filtered.
- [ ] Integration test proves an opted-out tenant is never reachable via public helpers.
- [ ] Permissions + feature flags (`FF_DIRECTORY`, `FF_PUBLIC_DIRECTORY`) enforced everywhere.
- [ ] i18n namespaces registered (en + fr) — directory, directory-public, changes.
- [ ] Nav entries conditional on permissions + flags.
- [ ] One E2E: focal person submits → manager batch-approves → public page at `/public/directory/*` shows the record without tenant attribution.
- [ ] `CLAUDE.md` gains a "Directory + Editorial Workflow" subsystem section.
