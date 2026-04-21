# Phase 5 — Components Library Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the production-grade component infrastructure from facilities into the template so every downstream form, list, and detail page can be built the way CLAUDE.md already documents. Ship the Conform stable wrapper + field wrappers (`CheckboxField`, `SwitchField`, `RadioGroupField`, `DatePickerField`, `SelectField`/`SearchableSelectField`), the `useCascade` hook for dependent dropdowns, a few small UI primitives those wrappers rely on (`switch`, `radio-group`, `calendar`, `empty-state`, `native-select`, `info-row`, `date-picker`, `date-time-picker`), and replace the template's current `@tanstack/react-table`-based DataTable with facilities' richer custom implementation (tree/hierarchy rows, toolbar with search/filters/actions, bulk actions, row actions with permission gating). Alternate views (kanban/calendar/gallery) and saved views stay out — they need the saved-view infra that a later phase owns.

**Architecture (what arrives in this phase):**

- `app/components/form.tsx` — ~870 lines. `useForm` wrapper (stable Conform API), re-exports of `getFormProps` / `getInputProps` / `getTextareaProps` / `getSelectProps`, `isSubmissionResult` type guard, and every field wrapper the template forms will reach for: `CheckboxField`, `SwitchField`, `RadioGroupField`, `DatePickerField`, `SelectField` + `SearchableSelectField` alias (client-side options OR server-side `fetchUrl` search mode, with controlled variant).
- `app/hooks/use-cascade.ts` — dependent-dropdown orchestration. Consumers declare a cascade tree (property → building → floor) and the hook owns fetcher lifecycle, key-based remounts, Conform `intent.update` value clearing, and `reload()`. No consumer `useState` / `useEffect` / `useRef` required.
- `app/hooks/use-base-prefix.ts` — 14-line helper returning `/${tenant}` or `/admin` so resource-route URLs inside `SearchableSelectField` and `useCascade` don't hardcode a tenant param.
- `app/components/ui/switch.tsx`, `radio-group.tsx`, `calendar.tsx`, `empty-state.tsx`, `native-select.tsx`, `info-row.tsx`, `date-picker.tsx`, `date-time-picker.tsx` — the small shadcn/Radix primitives the wrappers import, plus the two per-CLAUDE.md-convention pickers (`DatePicker` / `DateTimePicker`) that ship with a hidden input and integrate with plain `Form` submissions as well as with `DatePickerField`.
- `app/components/data-table/` — new folder replacing the flat `data-table.tsx` + `data-table-pagination.tsx` + `data-table-skeleton.tsx` + `data-table-columns.tsx` + `data-table-filter{,-badges}.tsx` files. Contains: `data-table.tsx` (core, ~420 lines) + `data-table-types.ts` + `data-table-column-header.tsx` + `data-table-pagination.tsx` + `data-table-row-actions.tsx` + `data-table-toolbar.tsx`. Custom `ColumnDef` (not tanstack's), expand/collapse for tree rows, selectable rows, permission-gated row/bulk/toolbar actions, search+filter toolbar wired to URL search params. Alternate view slots exist but are stubbed — passing `viewType="TABLE"` is all the template exercises in Phase 5.
- Dependency churn: add `@radix-ui/react-switch`, `@radix-ui/react-radio-group`, `react-day-picker`. Drop `@tanstack/react-table` (the new DataTable does not need it).
- One translation namespace update: `app/locales/{en,fr}/common.json` gains generic DataTable strings (`noResults`, `search`, `filter`, `clearFilters`, `rowsSelected`, `expand`, `collapse`, `loading`) so the table renders localized without forcing every consumer to pass copy.

**Tech stack touched:** `package.json` (three adds, one drop), `app/components/form.tsx` (new), `app/hooks/*.ts` (new), `app/components/ui/**` (eight new files), `app/components/data-table/**` (new folder, six files), `app/components/data-table.tsx` / `data-table-pagination.tsx` / `data-table-skeleton.tsx` / `data-table-columns.tsx` / `data-table-filter.tsx` / `data-table-filter-badges.tsx` (all deleted after callers migrate — today only admin user list and feature-flags consume the old DataTable), `app/components/checkbox-field.tsx` / `input-field.tsx` / `textarea-field.tsx` / `field.tsx` (consolidated into `form.tsx` + `ui/field.tsx`, then deleted), `app/routes/$admin/users.tsx` and `app/routes/$tenant/settings/features.tsx` (migrated to new DataTable), `app/locales/{en,fr}/common.json` (add keys).

**Spec:** `docs/superpowers/specs/2026-04-20-template-extraction-design.md`
**Reference (READ-ONLY):** `/Users/binalfew/Projects/facilities/` — port-from.
**Working directory:** `/Users/binalfew/Projects/templates/react-router`
**Branch:** `phase-5-components` off `main` (cut before Task 1).

---

## Hard constraints

- NEVER modify `/Users/binalfew/Projects/facilities`. `Read` only.
- Every task lands green (`typecheck`, `build`) before the next starts.
- No schema changes this phase. If Prisma suggests a migration, something is wrong — stop and re-read.
- Commitlint rules carry over (≤100 chars, lowercase, conventional prefix, no `--no-verify`).
- Do NOT port `~/components/views/kanban-board`, `calendar-view`, `gallery-grid`, or `~/components/views/view-switcher`. The DataTable's alternate-view slot stays as a prop shape only — passing `viewType !== "TABLE"` in this phase falls through to the table renderer. A later phase ships the saved-view infra and fills in those renderers.
- Do NOT port the `viewFilters` / `SavedView` wiring inside `DataTable` (facilities couples the toolbar with `resolveViewContext` loaders). Strip to basic URL-driven search + filter params; saved views come later.
- `form.tsx` stays on the **stable** Conform API (`useForm` from `@conform-to/react`, `unstable_useControl` is fine — it's the one documented stable-compatible hook). Do not port the legacy `configureForms` wrapper — the plan in `project_conform_stable_migration` memory confirms that pattern was abandoned in facilities anyway.
- Callers of the old DataTable must migrate in the same branch. No "legacy + new" dual exports — replace or delete.
- `useCascade` must remain consumer-simple (declarative levels, no imperative `useEffect`). If porting forces an API change from facilities, stop and flag it rather than paper over.

---

## Decisions locked in this phase

| Decision                                  | Choice                                                                                                                                                                                                | Rationale                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conform API                               | Stable (`useForm` from `@conform-to/react` + `unstable_useControl` for rich widgets)                                                                                                                  | Matches facilities' current state. Avoids the next migration.                                                                                            |
| Form wrapper surface                      | Single `app/components/form.tsx` exporting everything (`useForm`, `getFormProps`, field wrappers, `isSubmissionResult`).                                                                              | CLAUDE.md already documents `import { … } from "~/components/form"` — a single entry point is the contract. One file, ~870 lines, stays under 1k budget. |
| Delete standalone `*-field.tsx` files     | Yes: `checkbox-field.tsx`, `input-field.tsx`, `textarea-field.tsx` get merged into `form.tsx` or `ui/field.tsx`.                                                                                      | Current template splits them; facilities consolidates. Matches the idiom.                                                                                |
| DataTable engine                          | Custom (facilities' impl). Drop `@tanstack/react-table`.                                                                                                                                              | Facilities' table supports tree rows, permission-gated actions, URL-driven filters — features tanstack doesn't give for free. Two callers to migrate.    |
| Alternate views (kanban/calendar/gallery) | **Out of scope.** Props exist (`viewType`, `viewConfig`); renderers fall through to table.                                                                                                            | Saved-view infra + view switcher belong in a dedicated later phase. Keep the seam, skip the bodies.                                                      |
| Saved views / `resolveViewContext`        | Out of scope.                                                                                                                                                                                         | Same reason.                                                                                                                                             |
| DataTable translations                    | Add generic keys to `common.json` (`noResults`, `search`, `filter`, `clearFilters`, `rowsSelected`, `expand`, `collapse`, `loading`).                                                                 | Keeps DataTable i18n-ready without each consumer threading copy.                                                                                         |
| `useCascade` external contract            | Same API as facilities: `useCascade({ field, parent?, buildUrl?, intent })`.                                                                                                                          | Already battle-tested; CLAUDE.md documents it; no reason to redesign.                                                                                    |
| Base-prefix hook                          | Port `use-base-prefix.ts` unchanged. Works for `/admin` and `/$tenant` URLs.                                                                                                                          | Minimal surface; `SearchableSelectField` and `useCascade` need it.                                                                                       |
| Calendar primitive                        | `react-day-picker` via shadcn/ui `calendar.tsx`.                                                                                                                                                      | Facilities uses it. Install and copy.                                                                                                                    |
| Switch / RadioGroup primitives            | `@radix-ui/react-switch` and `@radix-ui/react-radio-group` via shadcn wrappers.                                                                                                                       | Facilities uses them; no alternative in the template.                                                                                                    |
| `DatePicker` vs `DatePickerField`         | Both ship. `DatePicker` is a bare shadcn picker with a hidden `name` input (for plain `<Form>` usage, per CLAUDE.md convention). `DatePickerField` is the Conform-integrated variant from `form.tsx`. | Keeps the template's form idioms aligned with CLAUDE.md's two documented patterns.                                                                       |
| Tanstack-table removal                    | Remove from `package.json` after both legacy DataTable callers migrate.                                                                                                                               | Pure simplification; no reason to ship two table engines.                                                                                                |

---

## File-level impact map

### New files

```
app/components/form.tsx                          — Conform wrapper + field wrappers (~870 lines)
app/hooks/use-cascade.ts                          — dependent-dropdown hook (~240 lines)
app/hooks/use-base-prefix.ts                      — tenant/admin URL base (~15 lines)
app/components/ui/switch.tsx                      — Radix switch wrapper (~30 lines)
app/components/ui/radio-group.tsx                 — Radix radio-group wrapper (~50 lines)
app/components/ui/calendar.tsx                    — react-day-picker wrapper (~80 lines)
app/components/ui/empty-state.tsx                 — data-table empty state (~40 lines)
app/components/ui/native-select.tsx               — styled native select for toolbars (~40 lines)
app/components/ui/info-row.tsx                    — detail-page key/value helper (~20 lines)
app/components/ui/date-picker.tsx                 — bare date picker w/ hidden input (~80 lines)
app/components/ui/date-time-picker.tsx            — bare datetime picker w/ hidden input (~100 lines)
app/components/data-table/data-table.tsx          — core (~420 lines, alternate-view stubs only)
app/components/data-table/data-table-types.ts     — ColumnDef + FilterDef + ToolbarAction (~120 lines)
app/components/data-table/data-table-column-header.tsx — sort header (~75 lines)
app/components/data-table/data-table-pagination.tsx   — pagination bar (~100 lines)
app/components/data-table/data-table-row-actions.tsx  — row dropdown w/ permission gate (~115 lines)
app/components/data-table/data-table-toolbar.tsx      — search + filters + actions (~215 lines)
```

### Modified files

```
package.json                                      — add @radix-ui/react-switch, @radix-ui/react-radio-group, react-day-picker; drop @tanstack/react-table
app/locales/en/common.json                        — add DataTable keys (noResults, search, filter, …)
app/locales/fr/common.json                        — mirror French
app/routes/admin/users.tsx (or equivalent)        — migrate from legacy DataTable to new DataTable
app/routes/$tenant/settings/features.tsx          — migrate from legacy DataTable to new DataTable
docs/CLAUDE.md-equivalent (README or docs)        — cross-link the component conventions (or defer until Phase 10 docs pass)
```

### Deleted files

```
app/components/data-table.tsx                     — replaced by data-table/ folder
app/components/data-table-pagination.tsx          — replaced
app/components/data-table-skeleton.tsx            — replaced (EmptyState covers the loading-empty seam; skeleton-as-separate-component dropped)
app/components/data-table-columns.tsx             — replaced by new types
app/components/data-table-filter.tsx              — replaced by new toolbar
app/components/data-table-filter-badges.tsx       — replaced by new toolbar
app/components/checkbox-field.tsx                 — consolidated into form.tsx
app/components/input-field.tsx                    — consolidated: use `<Input {...getInputProps(fields.x, { type: "text" })} />` inside `<Field>` directly
app/components/textarea-field.tsx                 — consolidated: use `<Textarea {...getTextareaProps(fields.x)} />` inside `<Field>`
```

Keep `app/components/field.tsx` → move to `app/components/ui/field.tsx` (small relocation; the existing `ui/field.tsx` path matches CLAUDE.md imports).

### Out of scope for Phase 5

- Alternate view renderers (`kanban`, `calendar`, `gallery`) + view switcher UI.
- `SavedView` / `ViewColumn` schema, `resolveViewContext`, saved-view middleware. Phase 6+.
- `FloorPlan` and other specialty widgets facilities owns — they belong to the FMS surface, not the template.
- Porting facilities' `app/components/hierarchy-tree.tsx`, `location-picker.tsx`, `location-breadcrumb.tsx` — same reason.
- Photo upload / logo upload / branding pickers — asset-heavy, add in a dedicated "uploads" phase.
- SSE/notification components (bell, listener, toast) — separate eventing phase.
- PWA / offline components — separate PWA phase.

---

## Pre-flight

### Task 0: Branch + baseline

- [ ] **Step 1: Confirm clean state.**
  ```bash
  cd /Users/binalfew/Projects/facilities && git status
  cd /Users/binalfew/Projects/templates/react-router && git status && git branch --show-current
  ```
- [ ] **Step 2: Cut the branch.** From the template repo root:
  ```bash
  cd /Users/binalfew/Projects/templates && git checkout -b phase-5-components
  ```
- [ ] **Step 3: Baseline.** `npm run typecheck && npm run build` both green on `main` tip.
- [ ] **Step 4: Inventory current DataTable callers.** Grep for imports of `~/components/data-table` and note every route file that will need migration in Task 9.
  ```bash
  cd /Users/binalfew/Projects/templates/react-router && grep -rn "from \"~/components/data-table" app/routes
  ```
  Expected: admin users list, settings features. If more appear, expand Task 9's scope.

---

## Group A — Dependencies + UI primitives (Tasks 1–2)

### Task 1: Install deps

**Files:** `package.json`, `package-lock.json`.

- [ ] **Step 1:** `npm install @radix-ui/react-switch @radix-ui/react-radio-group react-day-picker`.
- [ ] **Step 2:** Typecheck + build (no source changes yet; this just proves the adds don't break anything).
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "chore(template): add switch, radio-group, react-day-picker deps"
  ```

---

### Task 2: UI primitives (switch, radio-group, calendar, empty-state, native-select, info-row)

**Files (all new):**

- `app/components/ui/switch.tsx` — Radix-based switch, visually matches shadcn defaults.
- `app/components/ui/radio-group.tsx` — Radix radio-group + item + indicator.
- `app/components/ui/calendar.tsx` — `react-day-picker` wrapped with theme tokens.
- `app/components/ui/empty-state.tsx` — icon + title + description + optional action; used by DataTable.
- `app/components/ui/native-select.tsx` — styled native `<select>` used in toolbar filters (CLAUDE.md mandates `w-full sm:w-auto sm:min-w-[160px]` variant in toolbars).
- `app/components/ui/info-row.tsx` — small helper from CLAUDE.md's detail-page 2/3+1/3 layout.

- [ ] **Step 1: Port each file** from `/Users/binalfew/Projects/facilities/app/components/ui/` verbatim. Adjust any import paths that reference facilities-specific utils (most are `cn` from `~/utils/misc` — identical path in the template).
- [ ] **Step 2: Typecheck.** Expected to pass — these are self-contained primitives.
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add switch, radio-group, calendar, empty-state, native-select, info-row primitives"
  ```

---

## Group B — Date pickers (Task 3)

### Task 3: Bare `DatePicker` + `DateTimePicker` with hidden input

**Files (new):**

- `app/components/ui/date-picker.tsx` — shadcn-style popover + calendar, renders a hidden `<input name={name}>` so plain `<Form>` submissions work. Accepts `defaultValue?: Date`.
- `app/components/ui/date-time-picker.tsx` — same pattern with a time-of-day control.

These are separate from `DatePickerField` in `form.tsx`. CLAUDE.md mandates both: use `DatePicker` inside `useControl`-driven forms if the consumer wants, and `DatePickerField` for the Conform-integrated path. In practice most form code will go through `DatePickerField`, but non-Conform consumers (quick filter UIs, date range pickers outside forms) need the bare widget.

- [ ] **Step 1: Port both files** from facilities.
- [ ] **Step 2: Typecheck.**
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add date-picker and date-time-picker widgets"
  ```

---

## Group C — Form wrapper (Tasks 4–5)

### Task 4: Port `app/components/form.tsx`

**Files:**

- Create: `app/components/form.tsx` (~870 lines).
- Relocate: `app/components/field.tsx` → `app/components/ui/field.tsx` (if not already there). Update any existing imports.

**What ships:**

- `useForm(schema, options)` — returns `{ form, fields, intent }`. `intent` is an alias for `form` (stable FormMetadata exposes `.update()`, `.reset()`, `.validate()` directly).
- Re-exports: `getFormProps`, `getInputProps`, `getTextareaProps`, `getSelectProps` from `@conform-to/react`.
- `isSubmissionResult(value)` type guard for multi-intent fetcher actions.
- `CheckboxField`, `SwitchField`, `RadioGroupField`, `DatePickerField` — each uses `unstable_useControl` to bridge the rich widget with the hidden native input Conform tracks.
- `SelectField` + `SearchableSelectField` (alias) — four prop shapes:
  1. Client-side static options (`options: Array<{ value, label }>`).
  2. Server-side `fetchUrl` mode — debounced 300ms, queries `?q=` for search, `?id=` for label resolution on edit forms.
  3. Controlled variant (rare) — used for non-Conform consumers.
  4. Both include `onValueChange` so `useCascade` can chain levels.

- [ ] **Step 1: Copy `form.tsx` verbatim** from facilities. Check imports resolve (should all be `~/components/ui/…` which exists after Tasks 2–3).
- [ ] **Step 2: Typecheck.** Expected hiccups:
  - Any `@conform-to/zod` import must be `@conform-to/zod/v4` (facilities already uses v4; confirm line-by-line).
  - `date-fns` / `lucide-react` / `react` imports should be clean.
- [ ] **Step 3: Fix** any import-path or API-version mismatch, then typecheck + build.
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add Conform stable form wrapper + field wrappers"
  ```

---

### Task 5: Delete redundant standalone `*-field.tsx` files

**Files:**

- Delete: `app/components/checkbox-field.tsx`, `input-field.tsx`, `textarea-field.tsx`.
- Modify: any callers to import from `~/components/form` or spread `getInputProps` / `getTextareaProps` directly inside `<Field>`.

Inventory:

```bash
grep -rn "from \"~/components/checkbox-field\"\|from \"~/components/input-field\"\|from \"~/components/textarea-field\"" app
```

For each call site, replace:

```tsx
// before
<InputField fields={fields} name="email" label="Email" type="email" />

// after
<Field fieldId={fields.email.id} label="Email" errors={fields.email.errors}>
  <Input {...getInputProps(fields.email, { type: "email" })} key={fields.email.key} />
</Field>
```

- [ ] **Step 1: Migrate all call sites** (should be ~5–15 in auth + settings routes).
- [ ] **Step 2: Delete the three files.**
- [ ] **Step 3: Typecheck + build.**
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "refactor(template): drop standalone field components in favor of form.tsx wrappers"
  ```

---

## Group D — Hooks (Task 6)

### Task 6: Port `useCascade` + `useBasePrefix`

**Files (new):**

- `app/hooks/use-cascade.ts` (~240 lines).
- `app/hooks/use-base-prefix.ts` (~15 lines).

Expect no new dependencies. `useCascade` uses `useFetcher` from `react-router` and standard `useEffect` / `useRef`. The only external type dependency is the Conform `intent` / field-meta shape — already available via `form.tsx`.

- [ ] **Step 1: Port `use-base-prefix.ts`.** Trivial.
- [ ] **Step 2: Port `use-cascade.ts`.**
- [ ] **Step 3: Typecheck.** The hook's dev-time invariants (`IS_DEV` branch) use `process.env.NODE_ENV` — confirm `react-router` + vite build path reads that correctly (it does; facilities proves it).
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add useCascade + useBasePrefix hooks"
  ```

---

## Group E — DataTable (Tasks 7–10)

### Task 7: Move and expand into `app/components/data-table/` folder

**Files:**

- Create folder: `app/components/data-table/`.
- Create: `data-table-types.ts` — `ColumnDef<TData>`, `FilterDef`, `ToolbarAction`, `BulkAction`, `RowActionStyle`, `ViewType`, `DataTableProps<TData>`. Copy verbatim from facilities, **minus** any types that couple to `SavedView` or `ViewColumn`. Replace the view-config type's kanban/calendar/gallery config shapes with `unknown` placeholders or typed stubs that consumers can flesh out later — the core DataTable only needs the "which view are we in" discriminator.

No consumer migration yet — this task just lays the type ground.

- [ ] **Step 1: Create folder + `data-table-types.ts`.**
- [ ] **Step 2: Typecheck** (nothing references it yet; this is a standalone file).
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add data-table types"
  ```

---

### Task 8: Port `data-table-column-header`, `data-table-pagination`, `data-table-row-actions`

**Files (new):**

- `app/components/data-table/data-table-column-header.tsx`.
- `app/components/data-table/data-table-pagination.tsx`.
- `app/components/data-table/data-table-row-actions.tsx`.

`data-table-row-actions` imports a permission helper (`checkPermission` from facilities' `~/utils/auth/permissions`). The template has the equivalent utility from Phase 1 — wire to whatever the template called it (verify the import path in `app/utils/auth/`).

- [ ] **Step 1: Port all three** and reconcile any import drift.
- [ ] **Step 2: Typecheck.**
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add data-table column-header, pagination, row-actions"
  ```

---

### Task 9: Port `data-table-toolbar` + core `data-table.tsx`

**Files (new):**

- `app/components/data-table/data-table-toolbar.tsx` (~215 lines).
- `app/components/data-table/data-table.tsx` (~420 lines).

**Trimming:**

- In `data-table.tsx`, remove imports for `KanbanBoard`, `CalendarView`, `GalleryGrid`. Keep the `viewType` discriminator + `viewConfig` prop on `DataTableProps` so the contract matches facilities, but let the alternate-view branch fall through to the table renderer with a `// TODO(phase-6): alternate view renderers` comment. Do **not** render null — table fallback is the right degraded behaviour.
- Remove `useClientUser` coupling if facilities references it for row-action permission gating and the template's RBAC helper is different. Use whatever Phase 1 landed as the client-safe way to read current user roles. If no client-side helper exists yet, accept a `canPerformAction?: (action: string) => boolean` prop as an escape hatch; consumers can pass the result of a loader-computed permission map.
- Strip `resolveViewContext` references and any saved-view URL keys — this is the main facilities-specific coupling to cut.
- Translate user-visible strings via `useTranslation("common")` with the keys added in Task 10.

- [ ] **Step 1: Port the toolbar.** It imports `SelectField` from `~/components/form` — that's live after Task 4.
- [ ] **Step 2: Port the core DataTable.** Apply the trims above.
- [ ] **Step 3: Typecheck + build.**
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add data-table core + toolbar"
  ```

---

### Task 10: DataTable i18n keys

**Files:**

- Modify: `app/locales/en/common.json`, `app/locales/fr/common.json`.

Add keys used by the DataTable / toolbar:

```
"noResults": "No results", "fr": "Aucun résultat"
"search": "Search", "fr": "Rechercher"
"filter": "Filter", "fr": "Filtrer"
"clearFilters": "Clear filters", "fr": "Effacer les filtres"
"rowsSelected": "{{count}} rows selected", "fr": "{{count}} lignes sélectionnées"
"expand": "Expand", "fr": "Développer"
"collapse": "Collapse", "fr": "Réduire"
"loading": "Loading…", "fr": "Chargement…"
```

- [ ] **Step 1: Update both files.** Preserve existing key order; add the new ones in a logical group.
- [ ] **Step 2: Typecheck.**
- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "feat(template): add data-table translations to common namespace"
  ```

---

## Group F — Migrate callers + delete legacy (Tasks 11–12)

### Task 11: Migrate existing DataTable callers

**Files (modify):**

- `app/routes/admin/users.tsx` (or wherever Phase 1 put the admin user list).
- `app/routes/$tenant/settings/features.tsx`.

For each:

1. Swap `import { DataTable } from "~/components/data-table"` → `import { DataTable } from "~/components/data-table/data-table"` (or re-export from an `index.ts` if preferred; a short barrel file is acceptable — document the choice in the commit message).
2. Replace the tanstack `columns: ColumnDef<T, V>[]` with the new `columns: ColumnDef<T>[]` (note: no `V` type parameter; the template's `ColumnDef.cell` is either a key-of-TData string or a `(row) => ReactNode` function).
3. Remove `useReactTable`, `getCoreRowModel`, `getSortedRowModel`, `flexRender` imports.
4. Wire the toolbar — at minimum `searchConfig: { paramKey: "q", placeholder: t("search") }`. Add filters as the old page supported.
5. Delete `data-table-skeleton` usage — the new table shows `EmptyState` inline when `data.length === 0`; loading is parent-owned (show a skeleton in the route shell if needed).

- [ ] **Step 1: Migrate admin users page.** Smoke in dev: list renders, search works, sort works.
- [ ] **Step 2: Migrate settings features page.** Smoke: toggling a flag still works (row action / inline switch both preserved).
- [ ] **Step 3: Typecheck + build.**
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "refactor(template): migrate admin and features pages to new DataTable"
  ```

---

### Task 12: Delete legacy DataTable files + drop tanstack

**Files (delete):**

```
app/components/data-table.tsx
app/components/data-table-pagination.tsx
app/components/data-table-skeleton.tsx
app/components/data-table-columns.tsx
app/components/data-table-filter.tsx
app/components/data-table-filter-badges.tsx
```

**Modify:**

- `package.json` — remove `@tanstack/react-table`. Run `npm install` to sync lockfile.

- [ ] **Step 1: Delete the six files.**
- [ ] **Step 2: Drop the dep + reinstall.**
- [ ] **Step 3: Typecheck + build.** If typecheck fails, a caller was missed in Task 11 — track down and fix rather than restore the delete.
- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "chore(template): delete legacy data-table and drop @tanstack/react-table"
  ```

---

## Group G — Validation + docs (Tasks 13–14)

### Task 13: Docs — cross-link component conventions

**Files (modify):**

- `docs/CLAUDE.md-equivalent` (README.md if that's the template's instruction doc today).

Add a section summarizing the component conventions that now exist in the template (short — the real reference is facilities' CLAUDE.md, which the template will eventually mirror in its own Phase 10 docs pass):

```markdown
## Components (Phase 5)

- `app/components/form.tsx` — Conform stable wrapper. Import `useForm`, `getInputProps`, and field wrappers from here.
- `app/components/data-table/` — list-page DataTable with URL-driven search + filters.
- `app/hooks/use-cascade.ts` — dependent dropdowns without consumer `useState`.
- `app/hooks/use-base-prefix.ts` — resolves `/admin` or `/$tenant`.
- Form rules: see facilities CLAUDE.md "Form Handling" section; identical patterns apply.
```

- [ ] **Step 1: Add the section.** Keep it short; the authoritative patterns doc lands in a later docs phase.
- [ ] **Step 2: Commit.**
  ```bash
  cd /Users/binalfew/Projects/templates && git add -A && git commit -m "docs(template): cross-link Phase 5 component conventions"
  ```

---

### Task 14: Final validation + merge decision

- [ ] **Facilities clean.** `cd /Users/binalfew/Projects/facilities && git status` → clean working tree.
- [ ] **Typecheck.** `npm run typecheck` → pass.
- [ ] **Build.** `npm run build` → pass.
- [ ] **DB untouched.** `npm run db:push` (optional — no schema changes expected). `npm run db:seed` still green.
- [ ] **Dev smoke (quick, no Playwright).**
  1. Log in as admin → user list renders via new DataTable. Search + sort work.
  2. Open settings → features → toggle a flag (row action / inline switch).
  3. Open a form with a `CheckboxField`, `SwitchField`, `DatePickerField`, `SelectField` (client-side). Submit; see values round-trip.
  4. Wire a minimal `useCascade` example in a throwaway dev route or test page (property → building stub) and confirm child clears when parent changes.
- [ ] **Commit count.** `git log --oneline main..phase-5-components` — expect 12–14 commits.
- [ ] **Summary + pause for merge decision.**

---

## Rollback plan

- Per-task: `git reset --soft HEAD~1` to unstage + fix.
- Phase: `git checkout main && git branch -D phase-5-components`, then recreate from `main`.
- No schema rollback needed — no DB changes this phase.
- If tanstack removal (Task 12) proves premature, `npm install @tanstack/react-table` is a revert. Keep the per-task commits small so it's cheap to back out.

---

## Open questions deferred to per-task decisions

- Barrel `app/components/data-table/index.ts` for short imports, or direct `data-table/data-table` paths? Pick during Task 11 migration; lightweight barrel is fine if consumers already import `{ DataTable }`.
- If the admin users page or features page depends on tanstack-column-based sorting features (e.g., multi-sort, resizable columns), decide whether to keep those as future enhancements or to port them into the new DataTable. Default: drop them; facilities' table handles single-column sort via URL `sort` + `dir` params and that's all Phase 5 needs.
- `SearchableSelectField` currently always hits `/api/search-*` style resource routes under the tenant base. If the template wants to demonstrate a search resource route end-to-end in this phase, add a trivial `app/routes/$tenant/api/search-users.tsx` — otherwise defer. Plan assumes defer.
- Whether to add Playwright E2E coverage for the new DataTable in this phase. Default: defer to the "testing" phase. Typecheck + build + manual smoke gate is enough for a components port.

---

## Phase 5 open deviations (fill in during execution)

- [ ] Any imports from the tanstack table that couldn't be trivially translated to the new `ColumnDef` — note here.
- [ ] Any field wrapper behaviour that diverged from facilities during the port — note + justify.
- [ ] Any UI primitive whose visual styling had to be touched up for template defaults vs. facilities — note.
