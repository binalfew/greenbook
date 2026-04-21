import { useRef, useCallback, useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { Search, X } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { SelectField } from "~/components/form";
import type { FilterDef, ToolbarAction } from "./data-table-types";

interface DataTableToolbarProps {
  searchConfig?: { paramKey?: string; placeholder?: string };
  filters?: FilterDef[];
  toolbarActions?: ToolbarAction[];
  toolbarExtra?: React.ReactNode;
  selectedCount?: number;
  bulkActions?: ToolbarAction[];
  showCount?: boolean;
  totalCount?: number;
}

export function DataTableToolbar({
  searchConfig,
  filters,
  toolbarActions,
  toolbarExtra,
  selectedCount = 0,
  bulkActions,
  showCount,
  totalCount,
}: DataTableToolbarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const returnUrl = location.pathname + location.search;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchKey = searchConfig?.paramKey ?? "q";
  const currentSearch = searchParams.get(searchKey) ?? "";

  const handleSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams);
        if (value) {
          params.set(searchKey, value);
        } else {
          params.delete(searchKey);
        }
        params.delete("page");
        setSearchParams(params);
      }, 300);
    },
    [searchParams, searchKey, setSearchParams],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleFilterChange(paramKey: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(paramKey, value);
    } else {
      params.delete(paramKey);
    }
    params.delete("page");
    setSearchParams(params);
  }

  function clearSearch() {
    const params = new URLSearchParams(searchParams);
    params.delete(searchKey);
    params.delete("page");
    setSearchParams(params);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hasSearch = !!searchConfig;
  const hasFilters = filters && filters.length > 0;
  const hasToolbarActions = toolbarActions && toolbarActions.length > 0;
  const hasBulkSelection = selectedCount > 0 && bulkActions && bulkActions.length > 0;
  const hasAny = hasSearch || hasFilters || hasToolbarActions || toolbarExtra || hasBulkSelection;

  if (!hasAny && !showCount) return null;

  if (hasBulkSelection) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {selectedCount} selected
        </span>
        {bulkActions!.map((action) => {
          const Icon = action.icon;
          if (action.href) {
            return (
              <Button
                key={action.label}
                variant={action.variant ?? "outline"}
                size="default"
                asChild
              >
                <Link
                  to={`${action.href}${action.href.includes("?") ? "&" : "?"}redirectTo=${encodeURIComponent(returnUrl)}`}
                >
                  {Icon && <Icon />}
                  {action.label}
                </Link>
              </Button>
            );
          }
          return (
            <Button
              key={action.label}
              variant={action.variant ?? "outline"}
              size="default"
              onClick={action.onClick}
            >
              {Icon && <Icon />}
              {action.label}
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
      {toolbarExtra && <div className="w-full sm:w-auto">{toolbarExtra}</div>}

      {hasFilters &&
        filters!.map((filter) => (
          <div key={filter.paramKey} className="w-full sm:w-auto sm:min-w-[160px]">
            <SelectField
              value={searchParams.get(filter.paramKey) ?? ""}
              options={filter.options}
              placeholder={filter.placeholder ?? filter.label}
              onChange={(value) => handleFilterChange(filter.paramKey, value)}
            />
          </div>
        ))}

      {hasSearch && (
        <div className="relative w-full sm:min-w-0 sm:flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            ref={inputRef}
            placeholder={searchConfig!.placeholder ?? "Search..."}
            defaultValue={currentSearch}
            onChange={(e) => handleSearch(e.target.value)}
            className="pr-8 pl-8"
          />
          {currentSearch && (
            <button
              type="button"
              onClick={clearSearch}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
            >
              <X className="size-3.5" />
              <span className="sr-only">Clear search</span>
            </button>
          )}
        </div>
      )}

      {(showCount || hasToolbarActions) && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
          {showCount && totalCount !== undefined && (
            <span className="text-muted-foreground text-sm whitespace-nowrap">
              {totalCount} result{totalCount !== 1 ? "s" : ""}
            </span>
          )}
          {hasToolbarActions &&
            toolbarActions!.map((action) => {
              const Icon = action.icon;
              if (action.href) {
                return (
                  <Button
                    key={action.label}
                    variant={action.variant ?? "default"}
                    size="default"
                    className="flex-1 sm:flex-initial"
                    asChild
                  >
                    <Link
                      to={`${action.href}${action.href.includes("?") ? "&" : "?"}redirectTo=${encodeURIComponent(returnUrl)}`}
                    >
                      {Icon && <Icon />}
                      {action.label}
                    </Link>
                  </Button>
                );
              }
              return (
                <Button
                  key={action.label}
                  variant={action.variant ?? "default"}
                  size="default"
                  className="flex-1 sm:flex-initial"
                  onClick={action.onClick}
                >
                  {Icon && <Icon />}
                  {action.label}
                </Button>
              );
            })}
        </div>
      )}
    </div>
  );
}
