# Reference data (Phase 8)

Phase 8 ships four tenant-scoped reference-data entities: `Country`, `Title`, `Language`, `Currency`. Each row belongs to a tenant and is uniquely keyed by `(tenantId, code)`. Used as lookup lists in forms throughout the app.

## Service

`~/services/reference-data.server.ts` — CRUD per entity (`listX`, `listXPaginated`, `getX`, `createX`, `updateX`, `deleteX`) plus a dashboard helper `getReferenceDataCounts(tenantId)`. Duplicate-code errors throw `ReferenceDataError` with `code: "DUPLICATE_CODE"` so callers can surface field-level validation errors.

## Seed

`prisma/seed.ts` exports `seedReferenceData(tenantId)` and calls it for the system tenant on initial seed. Default sets:

- 8 countries (US, GB, FR, DE, ET, CA, JP, AU)
- 5 titles (Mr., Mrs., Ms., Dr., Prof.)
- 7 languages (English, French, German, Spanish, Arabic, Amharic, Chinese)
- 7 currencies (USD, EUR, GBP, JPY, ETB, CAD, AUD)

Apps building on the template call `seedReferenceData(newTenant.id)` from their tenant-provisioning helper to give new tenants a baseline.

## Admin UI

`$tenant/settings/references/` — index page shows counts + "Manage" links for each type. Full CRUD admins ship for all four: `countries/`, `titles/`, `languages/`, `currencies/`. Each uses the Phase 5 shared-editor pattern with its own schema and editor (`+shared/<entity>-editor.tsx` + `.server.tsx` + `<entity>-schema.ts`). Per-entity forms tune for the extra columns: countries include `alpha3` / `numericCode` / `phoneCode` / `flag`; languages add `nativeName`; currencies add `symbol` + `decimalDigits`.

## Feature flags + permissions

- No feature flag — reference data is always on.
- Permissions: `reference-data:{read,write,delete}` seeded in `UNIQUE_PERMISSIONS`; admin role gets them automatically.

## i18n

New namespace: `references` (27 keys). `settings.json` gained `navReferences` in en + fr.
