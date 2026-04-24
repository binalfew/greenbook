# Components (Phase 5)

The template ships a component library. Prefer these entry points when writing new routes — they're the canonical patterns referenced by later phases.

## Form handling

Import `useForm`, `getInputProps`, `getTextareaProps`, `getSelectProps`, `getFormProps`, and every field wrapper from `~/components/form`. The wrapper uses the **stable** Conform API (`@conform-to/react` + `@conform-to/zod/v4`) and centralises `shouldValidate`, `shouldRevalidate`, `constraint`, and client-side Zod validation. It returns `{ form, fields, intent }` — `intent` is an alias for `form` (stable `FormMetadata` exposes `.update()`, `.reset()`, `.validate()` directly).

Field wrappers (`CheckboxField`, `SwitchField`, `RadioGroupField`, `DatePickerField`, `SelectField`/`SearchableSelectField`) bridge shadcn/Radix components with a hidden native input via `unstable_useControl`. `SelectField` supports three prop shapes: client-side `options`, server-side `fetchUrl` (debounced search, label resolution on edit forms), and fully controlled (no Conform) for non-form consumers.

Every route — auth, tenant-scoped, settings — goes through `~/components/form` + shadcn `<Field>` / `<FieldLabel>` / `<FieldError>` composed directly. The earlier `~/components/field` (`FormField`) + `input-field` / `checkbox-field` / `textarea-field` surface was retired in a post-Phase-15 cleanup; if you see one in a downstream fork, migrate it to the canonical pattern so there's only one way to wire a form.

## Cascading dropdowns

Use `useCascade` from `~/hooks/use-cascade` for dependent selects (e.g., property → building → floor). The hook owns fetcher lifecycle, key-based remounts, and Conform value clearing. Root levels omit `parent`; child levels pass another binding as `parent` plus `buildUrl`, `intent`, and optional placeholders. Never manage cascade state with `useState` / `useEffect` / `useRef` in consumers.

## Base-prefix URLs

Use `useBasePrefix` from `~/hooks/use-base-prefix` inside components that need `/${tenant}` or `/admin` URL prefixes (resource route URLs for `SearchableSelectField.fetchUrl`, `useCascade.buildUrl`, etc.).

## DataTable

`~/components/data-table/data-table` exports `DataTable`, a custom list-page component with tree/hierarchy rows, URL-driven search + filters, selectable rows, and permission-gated row/bulk/toolbar actions. It uses a project-local `ColumnDef<TData>` type (not tanstack) — see `~/components/data-table/data-table-types`.

Permission gating is opt-in: pass `canPerformAction={(permission) => …}` to filter actions. When omitted, every action declaring a `permission` is hidden (fail-closed default).

Alternate view renderers (kanban, calendar, gallery) are not implemented in Phase 5; the `viewType` / `viewConfig` prop shape is preserved for forward-compat with a saved-views phase. Passing `viewType !== "TABLE"` falls through to the table renderer.

## UI primitives

Phase 5 added: `~/components/ui/switch`, `radio-group`, `calendar`, `empty-state`, `native-select`, `info-row`, `date-picker`, `date-time-picker`. The `date-picker` / `date-time-picker` are standalone widgets with a hidden `name` input that work in plain `<Form>` submissions — use `DatePickerField` from `~/components/form` when integrating with Conform.
