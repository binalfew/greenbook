import { Link, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import type { PaginationMeta } from "./data-table-types";

interface DataTablePaginationProps {
  pagination: PaginationMeta;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(searchParams);
  if (page <= 1) {
    params.delete("page");
  } else {
    params.set("page", String(page));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

export function DataTablePagination({ pagination }: DataTablePaginationProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, pageSize, totalCount, totalPages, pageSizeOptions } = pagination;

  const sizeOptions = pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;

  function handlePageSizeChange(newSize: string) {
    const params = new URLSearchParams(searchParams);
    params.set("pageSize", newSize);
    params.delete("page");
    setSearchParams(params);
  }

  return (
    <div className="flex items-center justify-between px-2">
      <p className="text-muted-foreground text-sm">
        {totalCount} result{totalCount !== 1 ? "s" : ""}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm whitespace-nowrap">Rows per page</span>
          <NativeSelect
            value={String(pageSize)}
            onChange={(e) => handlePageSizeChange(e.target.value)}
            size="sm"
            className="w-auto"
            aria-label="Rows per page"
          >
            {sizeOptions.map((size) => (
              <NativeSelectOption key={size} value={String(size)}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-sm whitespace-nowrap">
              Page {page} of {totalPages}
            </p>
            <Button variant="outline" size="icon" asChild disabled={page <= 1}>
              {page <= 1 ? (
                <span>
                  <ChevronLeft className="size-4" />
                  <span className="sr-only">Previous page</span>
                </span>
              ) : (
                <Link to={buildPageUrl(searchParams, page - 1)}>
                  <ChevronLeft className="size-4" />
                  <span className="sr-only">Previous page</span>
                </Link>
              )}
            </Button>
            <Button variant="outline" size="icon" asChild disabled={page >= totalPages}>
              {page >= totalPages ? (
                <span>
                  <ChevronRight className="size-4" />
                  <span className="sr-only">Next page</span>
                </span>
              ) : (
                <Link to={buildPageUrl(searchParams, page + 1)}>
                  <ChevronRight className="size-4" />
                  <span className="sr-only">Next page</span>
                </Link>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
