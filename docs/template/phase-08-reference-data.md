# Reference data (Phase 8)

Five lookup tables back the directory's forms: `Title`, `RegionalGroup`, `MemberState` (joined to regional groups through `MemberStateRegion`), `OrganizationType` and `PositionType`.

They are **shared**: none of these tables has a `tenantId`. There is one set for the whole platform, every tenant reads it, and only the global admin edits it.

> **Not shipped.** The original phase described tenant-scoped `Country`, `Language` and `Currency` tables and a `seedReferenceData(tenantId)` helper. Those models and that helper are not in the code.

## Service

`~/services/reference-data.server.ts` — per entity: `listXPaginated(options)`, `getX(id)`, `createX(input)`, `updateX(id, input)`, `deleteX(id)`. `listTitles(filter?)` and `listRegionalGroups()` return unpaginated lists for form selects. `getReferenceDataCounts()` feeds the index page. No function takes a tenant.

Codes are stored upper-case. Creating or renaming a row to a code that is already taken throws `ReferenceDataError` with `code: "DUPLICATE_CODE"`, which the editors surface as a field error. For member states the unique value is the abbreviation.

## Access

`~/utils/reference-data-access.server.ts`:

- `requireReferenceDataRead(request)` — for list pages; returns `{ user, canEdit }`, where `canEdit` is true for the global admin only.
- `requireReferenceDataAdmin(request)` — for new / edit / delete routes; refuses anyone who is not the global admin.

Only `reference-data:read` is seeded. Changes are gated on the global admin role, not on a permission; the seed removes `reference-data:{write,delete}` from a database that still has them.

## Seed

`prisma/seed.ts`:

- `seedTitles()` — Mr., Mrs., Ms., Dr., Prof.
- `seedDirectoryReference()` — organization types, position types, the five AU regional groups and the 55 member states with their region links.

Both are create-only: a row whose code already exists is left exactly as it is, so edits made in the app survive a re-seed. `mergeDuplicateReferenceData` in `prisma/seed-shared-reference-data.ts` runs first and folds together rows that an older, tenant-scoped database held once per tenant.

## Admin UI

`$tenant/settings/references/` — the index page shows a count and a link per type. Each type has its own folder (`titles/`, `regional-groups/`, `member-states/`, `organization-types/`, `position-types/`) with `index.tsx`, `new.tsx`, `$id.edit.tsx`, `$id.delete.tsx` and a `+shared/` editor (`<entity>-editor.tsx`, `.server.tsx`, `<entity>-schema.ts`).

## Feature flags + i18n

- No feature flag — reference data is always on.
- Strings live in the `references` namespace.
