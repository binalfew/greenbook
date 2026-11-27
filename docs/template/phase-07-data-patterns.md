# Data patterns (Phase 7 + 7b) — not shipped

> **Not shipped.** This phase planned saved views, view filters, custom field definitions, a cross-entity global search service, and a typed data-export service, with their admin screens (`ViewSwitcher`, `ExportButton`, a custom-fields settings page). None of it is in the code: there are no such services, routes, components, models, permissions, locale namespaces, or an `FF_SAVED_VIEWS` flag. Do not build on them. The file is kept so existing links resolve.

What does exist in this area:

## List pages

Tenant-scoped lists read their search, filter, sort and page state from the URL and pass it to a paginated service function. `app/routes/$tenant/directory/organizations/index.tsx` is the example to copy; the `DataTable` it renders is described in [phase-05-components.md](phase-05-components.md).

## Search

The only search in the app is the directory people search: the `/` page and the `/api/search-people` type-ahead, backed by `publicListPeople` in `~/services/people.server.ts`. See "Cross-tenant directory tier" in `CLAUDE.md`.

## Export

The only export is the audit-log CSV download on `$tenant/logs`. See [phase-09-privacy-audit.md](phase-09-privacy-audit.md).

## Soft delete

Soft delete is per-service: write callers set `deletedAt: new Date()` and read callers filter `{ deletedAt: null }`. There is no Prisma extension — the filter is explicit so that deleted rows stay reachable where they are needed (audit, history).
