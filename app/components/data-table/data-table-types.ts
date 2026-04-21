import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface ColumnDef<TData> {
  id: string;
  header: string;
  cell: keyof TData | ((row: TData) => ReactNode);
  sortable?: boolean;
  visible?: boolean;
  align?: "left" | "center" | "right";
  hideOnMobile?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface FilterDef {
  paramKey: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export interface ToolbarAction {
  label: string;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "outline" | "secondary" | "destructive" | "ghost";
  permission?: `${string}:${string}`;
}

export interface RowAction<TData> {
  label: string;
  icon?: LucideIcon;
  href?: (row: TData) => string;
  onClick?: (row: TData) => void;
  variant?: "default" | "destructive";
  visible?: (row: TData) => boolean;
  permission?: `${string}:${string}`;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  pageSizeOptions?: number[];
}

export interface EmptyStateConfig {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  rowKey?: keyof TData | ((row: TData) => string);

  // Toolbar
  searchConfig?: { paramKey?: string; placeholder?: string };
  filters?: FilterDef[];
  toolbarActions?: ToolbarAction[];
  toolbarExtra?: ReactNode;

  // Row actions
  rowActions?: RowAction<TData>[];
  rowActionsStyle?: "dropdown" | "inline";

  // Pagination (server-side)
  pagination?: PaginationMeta;

  // Sorting (URL-driven)
  sortParams?: { fieldKey?: string; directionKey?: string };

  // Selection
  selectable?: boolean;
  onSelectionChange?: (selectedKeys: string[]) => void;
  bulkActions?: ToolbarAction[];

  // Empty state
  emptyState?: EmptyStateConfig;

  // Permission gating — consumers supply a predicate over "resource:action"
  // strings. If omitted, all actions with a `permission` are hidden so the
  // template fails closed.
  canPerformAction?: (permission: `${string}:${string}`) => boolean;

  // Styling
  className?: string;
  showCount?: boolean;

  // Appearance
  striped?: boolean; // alternating row backgrounds, default true
  getRowClassName?: (row: TData) => string | undefined;

  // Tree / hierarchical rows (opt-in)
  getSubRows?: (row: TData) => TData[] | undefined;
  expandedByDefault?: boolean;
  treeIndent?: number; // px per depth level, default 24
}
