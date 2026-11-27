# Audit-log UI (Phase 9)

Phase 9 put an admin UI on top of the `AuditLog` model and the `writeAudit` helper from Phase 1.

> **Not shipped.** The privacy half of this phase — data subject requests (DSAR) and consent records — is not in the code. There are no `DataSubjectRequest` or `ConsentRecord` models, no `privacy.server.ts` service, no `$tenant/settings/privacy/` routes, no privacy schemas or constants, no `privacy` locale namespace, and no `privacy:*` permissions. The file keeps its old name so existing links resolve.

## Routes

`$tenant/logs/`:

- `index.tsx` — a DataTable with KPI cards, search, and action / entity / user / date filters. Adding `export=csv` to the same URL returns the filtered rows as a CSV download, capped at 10,000 rows.
- `$logId/index.tsx` — one audit record: an `InfoRow` grid plus the metadata JSON.

Both loaders call `requireTenantPermission(request, "audit-log", "read")`, so a user sees the log of the tenant in the URL only if they may act on that tenant.

## Permissions

`audit-log:read`, seeded in `prisma/seed.ts`. Of the seeded roles only `admin` holds it. There is no `write` or `delete` permission — audit records are append-only.

## Where records go

`AUDIT_SINK` (see `.env.example`) decides whether audit records are written to the database, emitted externally, or both. With `external` the database holds no rows and this viewer stays empty.

## i18n

Strings live in the `logs` namespace; the navigation label is `nav.logs`.

## Deviations

- **CSV export is a branch of the list loader** rather than a separate resource route.
- **No deep links from an audit record to its entity.** Entity ids render as plain text.
