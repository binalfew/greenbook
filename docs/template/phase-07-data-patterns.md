# Data patterns (Phase 7 + 7b)

Phase 7 added the saved-views, custom-fields, search, and export infrastructure. Phase 7b followed up with admin screens and reusable components.

## Saved views

`~/services/saved-views.server.ts` — per-user CRUD for persisted filter/sort/column state. A view belongs to a `(tenantId, userId, entityType)` tuple; setting one `isDefault` automatically clears others in the same scope.

`~/services/view-filters.server.ts` — `resolveViewContext(request, tenantId, userId, entityType, fieldMap)` is the helper for list-page loaders. It reads `?viewId` (or falls back to the user's default view), translates filters/sorts into Prisma `where`/`orderBy` clauses using the caller-provided `fieldMap`, and honours `?sort`/`?dir` URL params as an override.

Gated on `FF_SAVED_VIEWS` (default **off**). When disabled, `resolveViewContext` returns an empty context and the list page falls back to URL-driven sort only.

## Custom field definitions

`~/services/custom-fields.server.ts` — tenant-scoped custom field metadata per `entityType`. Definitions store `fieldType` (TEXT / NUMBER / DATE / SELECT / BOOLEAN / TEXTAREA), optional `options` for SELECT, `defaultValue`, and `sortOrder`. Consumer entities read definitions via `getCustomFieldsForEntity(tenantId, entityType)` and persist values in their own `metadata` JSON field.

## Search

`~/services/search.server.ts` — `globalSearch(query, tenantId, { limit? })` scans users, roles, permissions, and audit logs with case-insensitive `contains` matching. Returns a unified `SearchResult[]`. Apps extending the template add their own entity searches and compose with the template's helper.

## Export

`~/services/data-export.server.ts` — `rowsToExport(rows, entity, format)` converts any array of plain-object rows to a CSV (RFC 4180 quoting) or JSON payload. Per-entity wrappers `exportUsers` and `exportRoles` ship; `exportEntity(entity, tenantId, format)` dispatches. Apps add more entities by extending the switch in their own export helper.

## Soft delete

The template's soft-delete convention is per-service: write callers use `deletedAt: new Date()` and read callers filter `{ deletedAt: null }`. No Prisma extension — the pattern is explicit to keep developers aware that deleted rows are still queryable when needed (admin tools, undelete flows, audit reconciliation).

## Feature flags + permissions

- `FF_SAVED_VIEWS` (tenant-scope, default off) gates `resolveViewContext` from returning active-view data.
- Permissions: `saved-view:{read,write,delete}` and `custom-field:{read,write,delete}` seeded in `UNIQUE_PERMISSIONS`; admin role gets them automatically.

## Phase 7b UIs

### Custom fields admin

`$tenant/settings/custom-fields/` — full CRUD for `CustomFieldDefinition` rows. Uses the Phase 5 shared-editor pattern (`+shared/custom-field-editor.tsx` + `.server.tsx` + `custom-field-schema.ts`). Field types rendered in a native select: TEXT / NUMBER / DATE / SELECT / BOOLEAN / TEXTAREA. SELECT fields accept one option per line in a textarea. Settings sidebar gained a "Custom fields" entry (always visible — definitions are just metadata).

### ViewSwitcher component

`~/components/view-switcher.tsx` — dropdown toolbar control that renders available saved views, picks one via `?viewId=...`, and triggers save/delete/set-default actions. Consumers render it via a list-page DataTable's `toolbarExtra` slot and wire it to the `ViewContext` returned by `resolveViewContext`.

Paired resource routes at `$tenant/api/saved-views/`:

- `new.tsx` — full-page form that snapshots the referring URL's filter + sort params and writes a `SavedView`. Redirects back with `?viewId=<new>`.
- `$viewId.delete.tsx` — POST-only, deletes the view (honours the service's own-view-only check).
- `$viewId.set-default.tsx` — POST-only, toggles `isDefault`.

All three are gated on `FF_SAVED_VIEWS` via `requireFeature`. Deletions redirect back to the referrer with `viewId` stripped.

Consumer pattern in a list page:

```tsx
import { resolveViewContext } from "~/services/view-filters.server";
import { ViewSwitcher } from "~/components/view-switcher";

// loader:
const viewContext = await resolveViewContext(request, tenantId, userId, "asset", FIELD_MAP);
const items = await prisma.asset.findMany({ where: { tenantId, ...viewContext.viewWhere } });
return data({ items, viewContext });

// component:
<DataTable
  data={items}
  columns={columns}
  toolbarExtra={
    viewContext.savedViewsEnabled ? (
      <ViewSwitcher
        tenantSlug={tenant.slug}
        entityType="asset"
        activeViewId={viewContext.activeViewId}
        availableViews={viewContext.availableViews}
      />
    ) : undefined
  }
/>;
```

### ExportButton component

`~/components/export-button.tsx` — dropdown that renders CSV + JSON download links pointing at the caller's export URL (`?format=csv|json`). Consumers wire it to a tenant-scoped resource route that calls `exportEntity(entity, tenantId, format)` from Phase 7a's `data-export.server.ts` and returns the payload with `Content-Disposition: attachment`.

### i18n

New namespaces: `custom-fields` (30 keys) and `saved-views` (14 keys). Both registered in `~/utils/i18n.ts`.
