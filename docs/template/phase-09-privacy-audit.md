# Privacy & audit (Phase 9)

Phase 9 layers GDPR-style privacy primitives and an audit-log UI on top of the existing `AuditLog` model (shipped in Phase 1) + `writeAudit` helper.

## Schema

Two new tenant-scoped models added to `prisma/schema.prisma`:

- `DataSubjectRequest` — tracks DSAR workflow (`SUBMITTED` → `IDENTITY_VERIFICATION` → `IN_PROGRESS` → `COMPLETED`/`DENIED`/`CANCELLED`). Columns: `requestType` (`ACCESS`/`RECTIFICATION`/`ERASURE`/`RESTRICTION`/`PORTABILITY`/`OBJECTION`), `subjectEmail`, optional `subjectUserId`, `description`, `responseNotes`, `processedById` (FK to `User`, `SetNull`), `submittedAt`, `completedAt`, `deadlineAt` (defaults to submission + 30 days), `exportUrl`.
- `ConsentRecord` — tenant + user + purpose unique key. Tracks `lawfulBasis` (`CONSENT`/`CONTRACT`/`LEGITIMATE_INTEREST`/`LEGAL_OBLIGATION`), `isGranted`, `grantedAt`, `revokedAt`, optional `expiresAt` and `source`.

Back-relations wired on `Tenant` (`dataSubjectRequests`, `consentRecords`) and `User` (`consentRecords`, `dsrsProcessed` via the `"DSRProcessor"` named relation). Applied via `npx prisma db push --accept-data-loss` (template workflow — no migration file yet).

## Service

`~/services/privacy.server.ts` (~330 lines):

- **DSR:** `listDSRsPaginated`, `getDSR`, `submitDSR`, `processDSR`, `completeDSR`, `denyDSR`, `deleteDSR`.
- **Consent:** `listConsents`, `recordConsent` (upsert on `(tenantId, userId, purpose)`), `revokeConsent`, `hasConsent`.
- **Dashboard:** `getPrivacyDashboard(tenantId)` returns DSR counts (total/pending/overdue/completed/denied), consent counts (total/granted/revoked), and the 5 most recent DSRs.
- State-transition rules enforced in the service — `processDSR` only from `SUBMITTED`/`IDENTITY_VERIFICATION`; `completeDSR` only from `IN_PROGRESS`; `denyDSR` blocked from terminal states; `deleteDSR` blocked from `IN_PROGRESS`. Invalid transitions throw `PrivacyError` with a status code and `code` (`INVALID_STATUS_TRANSITION`, `CANNOT_DELETE_IN_PROGRESS`, etc.).

## Schemas + constants

- `~/utils/schemas/privacy.ts` — `createDSRSchema`, `completeDSRSchema`, `denyDSRSchema`, `recordConsentSchema`. `purpose` is a generic `z.string()` with 100-char cap — apps can feed any purpose string without schema edits.
- `~/utils/constants/privacy.ts` — `DSR_TYPE_KEYS` / `DSR_STATUS_KEYS` / `CONSENT_PURPOSE_KEYS` / `LAWFUL_BASIS_KEYS` as `readonly` tuples, plus per-key color maps for the badge renders. Consent purpose defaults shipped: `marketing_emails`, `analytics`, `third_party_sharing`, `cookies`, `newsletter`, `user_content`. Apps extend with additional purpose strings — the `purpose` column is `VarChar(100)` and doesn't enforce membership.

## Routes

- `$tenant/settings/privacy/index.tsx` — dashboard with DSR + consent KPI tiles and recent-DSRs table.
- `$tenant/settings/privacy/requests/` — DataTable index, `new.tsx` (`submitDSR`), `$requestId/index.tsx` (detail + intent-button workflow actions `process`/`complete`/`deny`), `$requestId/delete.tsx`.
- `$tenant/settings/privacy/consents/index.tsx` — DataTable listing with user search + purpose/granted filters (no write UI in the template — apps call `recordConsent` from their signup/settings flows).
- `$tenant/logs/` — audit-log admin. `index.tsx` renders a DataTable with KPI cards (actions today, deletes this week, total records), search, action/entity/user/date filters, and a CSV export that streams up to 10k rows. `$logId/index.tsx` shows a detail page with `InfoRow` grid + metadata JSON preview.

## Permissions

Added to `UNIQUE_PERMISSIONS` in `prisma/seed.ts` (module: `privacy`):

- `privacy:{read,write,delete}` — gates the DSR + consent routes.
- `audit-log:read` — gates the `/logs` admin.

Admin role picks them up automatically on seed.

## Navigation

- Top tenant nav gains a "Logs" `NavLink` (next to Settings) — text resolved from `nav.logs`.
- Settings sidebar gains a "Privacy" entry below "Reference data" — text resolved from `settings.navPrivacy`. Always visible (privacy is a compliance concern, not a feature-flaggable subsystem).

## i18n

Two new namespaces registered in `~/utils/i18n.ts`:

- `privacy` (~90 keys) — dashboard, DSR list/detail/delete, consent list, purposes, lawful bases, DSR types + statuses.
- `logs` (~25 keys) — audit-log admin + detail UI strings.

`nav.json` gets a `logs` entry (en + fr). `settings.json` gets a `navPrivacy` entry (en + fr).

## Deviations

- **Consent write UI deferred.** The template ships read-only consent management — the service exposes `recordConsent`/`revokeConsent` but there's no admin form. Apps typically call `recordConsent` from signup, cookie-banner acceptance, or per-user settings pages.
- **DSR detail uses intent-button fetcher forms** rather than a separate action route for each transition. The `deny` button currently submits with a canned reason — a dedicated "deny with notes" flow is a future enhancement.
- **No CSV export for DSRs or consents yet.** Logs have CSV export because audit logs get large fast. DSR/consent exports can be added via Phase 7b's `ExportButton` if needed.
- **CSV export streams via an `export=csv` search-param branch in the same loader** rather than a separate resource route. If export needs grow, factor out to `$tenant/api/logs-export.tsx`.
- **Audit log emission is still sparse.** Phase 1 shipped `writeAudit` and the `AuditLog` model; emission at call sites is a per-service pass apps take on.
- **No per-entity deep links from the audit-log detail page.** Entity IDs render as plain monospace strings.
- **`audit-log` has no `write`/`delete` permissions** — audit logs are append-only.
