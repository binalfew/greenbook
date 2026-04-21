import { useState, useCallback, useMemo } from "react";
import { useRouteLoaderData, useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { hasPermission, type Permission } from "~/config/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Checkbox } from "~/components/ui/checkbox";
import { EmptyState } from "~/components/ui/empty-state";
import { cn } from "~/utils/misc";
import type { DataTableProps, ColumnDef } from "./data-table-types";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableRowActions } from "./data-table-row-actions";
import { DataTableToolbar } from "./data-table-toolbar";

function getRowKey<TData>(row: TData, rowKey: DataTableProps<TData>["rowKey"]): string {
  if (typeof rowKey === "function") return rowKey(row);
  const key = rowKey ?? ("id" as keyof TData);
  return String((row as Record<string, unknown>)[key as string] ?? "");
}

function renderCell<TData>(column: ColumnDef<TData>, row: TData) {
  if (typeof column.cell === "function") {
    return column.cell(row);
  }
  const value = (row as Record<string, unknown>)[column.cell as string];
  return value != null ? String(value) : "";
}

interface FlatRow<TData> {
  row: TData;
  depth: number;
  hasChildren: boolean;
}

function flattenRows<TData>(
  rows: TData[],
  getSubRows: (row: TData) => TData[] | undefined,
  expandedKeys: Set<string>,
  rowKey: DataTableProps<TData>["rowKey"],
  depth = 0,
): FlatRow<TData>[] {
  const result: FlatRow<TData>[] = [];
  for (const row of rows) {
    const children = getSubRows(row);
    const hasChildren = (children?.length ?? 0) > 0;
    result.push({ row, depth, hasChildren });
    const key = getRowKey(row, rowKey);
    if (hasChildren && expandedKeys.has(key)) {
      result.push(...flattenRows(children!, getSubRows, expandedKeys, rowKey, depth + 1));
    }
  }
  return result;
}

export function DataTable<TData>({
  data,
  columns,
  rowKey,
  searchConfig,
  filters,
  toolbarActions,
  toolbarExtra,
  rowActions,
  rowActionsStyle = "dropdown",
  pagination,
  sortParams,
  selectable,
  onSelectionChange,
  bulkActions,
  emptyState,
  canPerformAction,
  className,
  showCount,
  striped = true,
  getRowClassName,
  getSubRows,
  expandedByDefault = false,
  treeIndent = 24,
}: DataTableProps<TData>) {
  const [searchParams] = useSearchParams();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // When callers don't pass `canPerformAction` explicitly, fall back to the
  // tenant layout's `permissions` list so permission-gated actions render.
  const tenantLayoutData = useRouteLoaderData("routes/$tenant/_layout") as
    | { permissions?: Permission[] }
    | undefined;
  const resolvedCanPerformAction = useMemo(() => {
    if (canPerformAction) return canPerformAction;
    const permissions = tenantLayoutData?.permissions ?? [];
    return (required: `${string}:${string}`) => hasPermission(permissions, required);
  }, [canPerformAction, tenantLayoutData?.permissions]);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    if (!expandedByDefault || !getSubRows) return new Set<string>();
    const keys = new Set<string>();
    function collectExpandable(rows: TData[]) {
      for (const row of rows) {
        const children = getSubRows!(row);
        if (children?.length) {
          keys.add(getRowKey(row, rowKey));
          collectExpandable(children);
        }
      }
    }
    collectExpandable(data);
    return keys;
  });

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const flatRows = useMemo(() => {
    if (!getSubRows) return null;
    return flattenRows(data, getSubRows, expandedKeys, rowKey);
  }, [data, getSubRows, expandedKeys, rowKey]);

  const filteredToolbarActions = useMemo(
    () => toolbarActions?.filter((a) => !a.permission || resolvedCanPerformAction(a.permission)),
    [toolbarActions, resolvedCanPerformAction],
  );

  const filteredRowActions = useMemo(
    () => rowActions?.filter((a) => !a.permission || resolvedCanPerformAction(a.permission)),
    [rowActions, resolvedCanPerformAction],
  );

  const visibleColumns = columns.filter((col) => col.visible !== false);
  const hasRowActions = filteredRowActions && filteredRowActions.length > 0;

  const fieldKey = sortParams?.fieldKey ?? "sort";
  const directionKey = sortParams?.directionKey ?? "dir";

  const currentSort = searchParams.get(fieldKey);
  const currentDir = searchParams.get(directionKey);

  const updateSelection = useCallback(
    (next: Set<string>) => {
      setSelectedKeys(next);
      onSelectionChange?.(Array.from(next));
    },
    [onSelectionChange],
  );

  function toggleAll(checked: boolean) {
    if (checked) {
      const allKeys = new Set(data.map((row) => getRowKey(row, rowKey)));
      updateSelection(allKeys);
    } else {
      updateSelection(new Set());
    }
  }

  function toggleRow(key: string, checked: boolean) {
    const next = new Set(selectedKeys);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    updateSelection(next);
  }

  const allSelected = data.length > 0 && selectedKeys.size === data.length;
  const someSelected = selectedKeys.size > 0 && selectedKeys.size < data.length;

  function renderContentArea() {
    return (
      <div className="bg-card rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              {visibleColumns.map((col, colIndex) => {
                const isSorted = col.sortable && currentSort === col.id;
                const ariaSortValue = isSorted
                  ? currentDir === "asc"
                    ? ("ascending" as const)
                    : ("descending" as const)
                  : col.sortable
                    ? ("none" as const)
                    : undefined;
                const isFirstCol = colIndex === 0 && !selectable;

                return (
                  <TableHead
                    key={col.id}
                    aria-sort={ariaSortValue}
                    className={cn(
                      isFirstCol && "pl-4",
                      col.hideOnMobile && "hidden md:table-cell",
                      col.align === "center" && "text-center",
                      col.align === "right" && "text-right",
                      col.headerClassName,
                    )}
                  >
                    {col.sortable ? (
                      <DataTableColumnHeader
                        title={col.header}
                        field={col.id}
                        sortable
                        align={col.align}
                        fieldKey={fieldKey}
                        directionKey={directionKey}
                      />
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
              {hasRowActions && (
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody aria-live="polite">
            {(flatRows ?? data.map((row) => ({ row, depth: 0, hasChildren: false }))).map(
              (entry, rowIndex) => {
                const { row, depth, hasChildren } = entry as FlatRow<TData>;
                const key = getRowKey(row, rowKey);
                const isSelected = selectedKeys.has(key);
                const isExpanded = expandedKeys.has(key);
                const isTreeMode = !!getSubRows;
                const isChild = depth > 0;

                return (
                  <TableRow
                    key={key}
                    data-state={isSelected ? "selected" : undefined}
                    aria-selected={selectable ? isSelected : undefined}
                    className={cn(
                      (isChild || (striped && rowIndex % 2 === 1)) && "bg-muted/30",
                      getRowClassName?.(row),
                    )}
                  >
                    {selectable && (
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleRow(key, checked === true)}
                          aria-label={`Select row ${key}`}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.map((col, colIndex) => {
                      const isFirstCol = colIndex === 0 && !selectable;
                      return (
                        <TableCell
                          key={col.id}
                          className={cn(
                            isFirstCol && "pl-4",
                            col.hideOnMobile && "hidden md:table-cell",
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right",
                            col.cellClassName,
                          )}
                        >
                          {isTreeMode && colIndex === 0 ? (
                            <div
                              className="flex items-center gap-1"
                              style={{ paddingLeft: depth * treeIndent }}
                            >
                              {hasChildren ? (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(key)}
                                  className="hover:bg-muted flex size-5 shrink-0 items-center justify-center rounded"
                                  aria-expanded={isExpanded}
                                  aria-label={isExpanded ? "Collapse row" : "Expand row"}
                                >
                                  <ChevronRight
                                    className={cn(
                                      "text-muted-foreground size-3.5 transition-transform",
                                      isExpanded && "rotate-90",
                                    )}
                                  />
                                </button>
                              ) : (
                                <span className="w-5 shrink-0" />
                              )}
                              {renderCell(col, row)}
                            </div>
                          ) : (
                            renderCell(col, row)
                          )}
                        </TableCell>
                      );
                    })}
                    {hasRowActions && (
                      <TableCell className="text-right">
                        <DataTableRowActions
                          row={row}
                          actions={filteredRowActions!}
                          style={rowActionsStyle}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              },
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Show empty state
  if (data.length === 0 && emptyState) {
    return (
      <div className={cn("space-y-4", className)}>
        <DataTableToolbar
          searchConfig={searchConfig}
          filters={filters}
          toolbarActions={filteredToolbarActions}
          toolbarExtra={toolbarExtra}
          showCount={showCount}
          totalCount={0}
        />
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
          action={emptyState.action}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <DataTableToolbar
        searchConfig={searchConfig}
        filters={filters}
        toolbarActions={filteredToolbarActions}
        toolbarExtra={toolbarExtra}
        selectedCount={selectedKeys.size}
        bulkActions={bulkActions}
        showCount={showCount}
        totalCount={pagination?.totalCount ?? data.length}
      />

      {renderContentArea()}

      {pagination && <DataTablePagination pagination={pagination} />}
    </div>
  );
}

export type { DataTableProps, ColumnDef } from "./data-table-types";
export type {
  FilterDef,
  ToolbarAction,
  RowAction,
  PaginationMeta,
  EmptyStateConfig,
} from "./data-table-types";
