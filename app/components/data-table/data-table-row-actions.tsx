import { Link, useLocation } from "react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { RowAction } from "./data-table-types";

interface DataTableRowActionsProps<TData> {
  row: TData;
  actions: RowAction<TData>[];
  style: "dropdown" | "inline";
}

function appendRedirectTo(href: string, returnUrl: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}redirectTo=${encodeURIComponent(returnUrl)}`;
}

export function DataTableRowActions<TData>({
  row,
  actions,
  style,
}: DataTableRowActionsProps<TData>) {
  const location = useLocation();
  const returnUrl = location.pathname + location.search;
  const visibleActions = actions.filter((action) => !action.visible || action.visible(row));

  if (visibleActions.length === 0) return null;

  if (style === "inline") {
    return (
      <div className="flex items-center justify-end gap-1">
        {visibleActions.map((action) => {
          const Icon = action.icon;
          const button = (
            <Button
              key={action.label}
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${action.variant === "destructive" ? "text-destructive hover:text-destructive" : ""}`}
              onClick={action.onClick ? () => action.onClick!(row) : undefined}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              <span className="sr-only">{action.label}</span>
            </Button>
          );

          if (action.href) {
            return (
              <Button
                key={action.label}
                variant="ghost"
                size="sm"
                asChild
                className={`h-8 w-8 p-0 ${action.variant === "destructive" ? "text-destructive hover:text-destructive" : ""}`}
              >
                <Link to={appendRedirectTo(action.href(row), returnUrl)}>
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  <span className="sr-only">{action.label}</span>
                </Link>
              </Button>
            );
          }

          return button;
        })}
      </div>
    );
  }

  // Dropdown mode
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <ChevronDown className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visibleActions.map((action) => {
          const Icon = action.icon;

          if (action.href) {
            return (
              <DropdownMenuItem key={action.label} variant={action.variant} asChild>
                <Link to={appendRedirectTo(action.href(row), returnUrl)}>
                  {Icon && <Icon className="size-4" />}
                  {action.label}
                </Link>
              </DropdownMenuItem>
            );
          }

          return (
            <DropdownMenuItem
              key={action.label}
              variant={action.variant}
              onClick={() => action.onClick?.(row)}
            >
              {Icon && <Icon className="size-4" />}
              {action.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
