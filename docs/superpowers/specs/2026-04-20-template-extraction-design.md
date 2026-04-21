# Template Extraction — Design Spec

**Date:** 2026-04-20
**Source:** `/Users/binalfew/Projects/facilities` (read-only reference)
**Target:** `/Users/binalfew/Projects/templates/react-router` (this repo)

## Goal

Migrate every generic (non-FMS) improvement that the facilities app accumulated since it forked from this template, so future apps can start from a richer, battle-tested baseline. The template stays **domain-agnostic**, **living** (future updates flow in over time), and **independent** (not a fork of any product).

## Hard constraints

1. **Never modify** `/Users/binalfew/Projects/facilities`. Treat it as read-only. No edits, no commits in that repo.
2. **Never copy domain-specific code** from facilities (see "Excluded" below). When in doubt, skip it.
3. Each phase must land green — `typecheck`, `build`, Prisma migrate, existing tests — before moving to the next phase.
4. Commits happen only when the user explicitly approves. Phases can be written, reviewed, and validated without committing until the user says so.

## Architectural decisions (approved 2026-04-20)

1. **Multi-tenant by default** — every app-facing route lives under `$tenant/`, matching the facilities pattern. Apps that don't need multi-tenancy can collapse it, but the default is multi-tenant so the RBAC/audit/notification plumbing has a tenant boundary to anchor to.
2. **Opinionated maximal** — the template ships everything in the "Generic" inventory below. No "optional module" toggles. Apps that don't need a subsystem can delete it; this is cheaper than designing pluggability.
3. **One demo entity** — a generic **Notes** CRUD that exercises every pattern (shared editor, cascading selects, saved views, custom fields, dialog delete, intent buttons, responsive toolbar). Serves as documentation-by-example.

## Scope

### Generic (migrate to template)

| Group | Items |
|---|---|
| Auth hardening | 2FA (setup/verify/recovery codes), SSO (OIDC + SAML), impersonation, API keys + rate-limit tiers, accept-invite flow, password history, change-expired-password |
| RBAC | RolePermission/UserRole join tables, RoleScope (GLOBAL/TENANT/EVENT), `requirePermission`/`requireRole`/`requireAnyRole`/`requireGlobalAdmin`/`requireFeature` helpers |
| Multi-tenancy shell | `$tenant/` layout, tenant CRUD, ServiceContext/TenantServiceContext, `buildServiceContext`, tenant-setup service, invitations |
| Settings & flags | SystemSetting + registry, FeatureFlag + admin UI, business-hours profiles, organization settings |
| Events & jobs | Job queue + IdempotencyKey, domain event bus, webhooks (subscriptions + delivery + emitter), notifications (model + bell + listener + SSE), announcements |
| Data patterns | Saved views + view-filters, custom fields, search, data import/export, soft-delete Prisma extension, memory cache |
| Privacy / audit | AuditLog (structured), DataSubjectRequest, ConsentRecord, rate-limit audit, impersonation audit |
| i18n | en/fr (es optional), namespace registration pattern, common.json convention |
| Reference data | Country, Title, Language, Currency (and **only** these — nothing FMS-shaped) |
| Components | `~/components/form` stable wrapper + field wrappers, Conform + Zod patterns, `useCascade` hook, DatePicker/DateTimePicker, permission-gate, skeletons, error boundaries, photo/file upload, logo upload, branding color picker, notification listener |
| Offline / PWA | service worker, offline store, fetch queue, sync manager, offline banner |
| Server | correlation IDs, structured logging, rate limiting, Sentry, graceful shutdown |
| Testing harness | vitest unit + integration (+ test DB), Playwright E2E, factories, MSW mocks |
| Tooling | commitlint, husky + lint-staged, Docker Compose (pg + mailpit + test DB), Prisma 7 upgrade |
| Docs | CLAUDE.md with entity route structure, shared editor, dialog routes, action error-handling, cascading dropdowns, form handling, responsive design |

### Excluded (domain-specific — NEVER copy)

Locations (Property/Building/Floor/Room/Zone/Outdoor/Region), Assets (AssetCategory/Asset/AssetWarranty/*), Work Orders (WorkOrder/SLA/Approval/Permit/*), Maintenance (MaintenanceSchedule/*), Inventory (Item/Stockroom/StockLevel/*), Vendors, Spaces, Leases, Capital Projects, Compliance, Industry modules, IoT/Sensor/EnergyMeter, AI/ML (MLModel/Prediction/AnomalyRecord), Shifts, Physical Access (KeySystem/MechanicalKey/AccessCard), Workforce/Staff/Certifications, FMS-flavored reference data (RoomType, ZoneType, OutdoorType, PropertyType, LocationStatus).

Rule of thumb: if the concept only makes sense inside "facility management", it's excluded. If it would make sense for a CRM, a LMS, a booking system, or a B2B SaaS admin panel, it's generic.

## Phase plan

Dependency-ordered. Each phase is one spec → plan → implementation cycle in its own session.

```
0.  Foundation           — deps upgrade, utils/ reorg, CLAUDE.md, Docker, tooling
1.  Auth & RBAC          — 2FA, recovery codes, role/permission joins, requireX helpers, audit log,
                           impersonation, API keys + rate-limit tiers
2.  Multi-tenancy shell  — $tenant/ layout, tenant CRUD, ServiceContext, invitations, tenant-setup
3.  Settings & flags     — SystemSetting, FeatureFlag, business-hours, organization settings
4.  i18n                 — locales, namespace conventions, translation helpers
5.  Components library   — Conform stable wrapper, field wrappers, useCascade, DataTable upgrade
6.  Events & jobs        — job queue, idempotency, domain events, webhooks, notifications, SSE
7.  Data patterns        — saved views, custom fields, search, import/export, soft-delete
8.  Reference data       — Country/Title/Language/Currency + admin UI
9.  Privacy              — DSAR, consent records, deeper audit
10. SSO                  — OIDC + SAML
11. Offline / PWA        — service worker, sync manager
12. Testing harness      — vitest integration + Playwright + factories + MSW
13. Server hardening     — correlation IDs, rate limiting, Sentry, graceful shutdown
14. Demo entity (Notes)  — exercises every pattern as living documentation
15. Docs polish          — full CLAUDE.md port, README, examples
```

Phase ordering is constrained by dependency:

- Foundation (0) before anything — reorg + deps upgrade ripples through every file.
- Auth/RBAC (1) before multi-tenancy (2) because RBAC helpers gate tenant routes.
- Multi-tenancy (2) before settings (3) because `SystemSetting` scopes by tenant.
- Components (5) before jobs/webhooks/data (6, 7) because their admin UIs use the components.
- Demo entity (15) goes second-to-last so it exercises the full stack.
- Docs polish (16) last because it documents everything that landed.

## Per-phase validation checklist

Every phase ends with:

1. `npm run typecheck` — passes with zero errors.
2. `npm run build` — production build succeeds.
3. `npx prisma migrate status` — clean; migrations apply on a fresh DB.
4. Existing tests — all green. New phase-specific tests — added and green.
5. `npm run dev` — starts without warnings; smoke-check the phase's key routes manually or via Playwright.
6. Write a short phase summary (what changed, what's next) and show it to the user.
7. Commit only after explicit user approval. Commits are one per phase, with a conventional-commits message (`feat(template): phase N — <name>`).

**Regression guard:** after every phase, the facilities app is verified unchanged by `cd /Users/binalfew/Projects/facilities && git status` — it must report "working tree clean". Any accidental write there is rolled back immediately.

## Rollback strategy

- Each phase is a single commit on the template repo's `main` branch (or a feature branch like `phase-N-<slug>`, decided at phase-start).
- If a phase breaks something and the user wants to roll back, `git revert <phase-commit>` restores the prior state.
- No destructive operations (no `--force`, no hard resets) without explicit user approval.
- No migration that drops/renames columns on a model already in use — add-then-remove in two phases if needed.

## Demo entity: Notes

A generic Notes model that exercises the full pattern surface:

- `Note` Prisma model with `tenantId`, `title`, `content` (markdown), `status` (DRAFT/PUBLISHED/ARCHIVED), `categoryId` (FK → NoteCategory), `tags` (array), `dueDate?`, `authorId`, soft delete, versioning, custom fields.
- `NoteCategory` Prisma model — small reference with `name`, `color`, hierarchical parent (demonstrates cascading selects).
- Routes at `$tenant/notes/` — index with DataTable + saved views + search; new.tsx + `$noteId_.edit.tsx` using the shared-editor pattern; `$noteId._layout.tsx` detail with 2/3 + 1/3; `$noteId.delete.tsx` dialog; `$noteId.comments.*` dialog sub-entity.
- Service at `services/notes.server.ts` with `getNote`, `listNotes`, `createNote`, `updateNote`, `deleteNote`, custom-fields integration, search integration.
- Schema at `utils/schemas/notes.ts` with Conform-compatible Zod + async `superRefine` for tenant-scoped FK checks.
- Seeds in `prisma/seed/notes.ts` with sample data.
- Tests: unit for service, integration for schema, E2E for the happy path.
- i18n: `app/locales/en/notes.json` + fr registered via the namespace convention.
- Navigation: one entry under "Content" group, feature-flagged `FF_NOTES`.

This is the only "example" content in the template — everything else is generic plumbing.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Accidentally modifying facilities | Every phase's validation step runs `git status` in facilities and halts if dirty. |
| Prisma migration conflicts on future upgrades | Additive-only migrations; never drop/rename a column in use. One migration per phase. |
| Replacing template code that consumers have already forked | Template is young (5 commits). No known downstream consumers besides facilities (which is frozen). Document breaking changes in each phase commit. |
| Phase drift — copying patterns without their dependencies | Each phase's spec lists exact files + their imports. Dependencies in later phases are stubbed, not half-copied. |
| i18n namespace registration forgotten | CLAUDE.md in phase 0 documents the registration rule; every phase that adds a namespace adds it to `utils/i18n.ts` and is flagged in the phase checklist. |
| Scope creep into FMS territory | "Excluded" list above is authoritative. When a facilities file is ambiguous, default to exclude; revisit later if needed. |

## Open questions deferred to per-phase specs

- Tab vs space indentation (template uses tabs, facilities uses 2-space) → decide in phase 0.
- Keep `@paralleldrive/cuid2` or switch to Prisma's default `cuid` → phase 0.
- `tsconfig` strictness level → phase 0.
- Do we want `@epic-web/cachified` or the facilities in-memory cache → phase 7.
- Keep Docker Compose with mailpit or use Resend mocks from the existing template → phase 0.
- Sentry server + client, or server only → phase 14.

## What "done" looks like

- Template repo builds, typechecks, tests pass.
- A new app forked from the template can: sign up, sign in, accept an invite, set up 2FA, manage a tenant, manage users with RBAC, create a Note, save a view on the Notes list, receive a notification, be impersonated by a GlobalAdmin, and toggle a feature flag.
- CLAUDE.md documents every pattern; a developer unfamiliar with the codebase can build a new entity following the patterns without reading the internals of any service.
- Facilities repo is byte-identical to its state at the start of this project.

## Out of scope for this extraction

- Facilities migration onto the new template (deferred — "hybrid C" decision).
- A second domain app proving the template (deferred until template stabilizes).
- Public release / OSS licensing (deferred).
- CI/CD pipeline setup (deferred — per-repo concern).
