import { useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/utils/misc";

interface DataTableColumnHeaderProps {
  title: string;
  field: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  className?: string;
  fieldKey?: string;
  directionKey?: string;
}

export function DataTableColumnHeader({
  title,
  field,
  sortable,
  align = "left",
  className,
  fieldKey = "sort",
  directionKey = "dir",
}: DataTableColumnHeaderProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  if (!sortable) {
    return (
      <div className={cn("flex items-center", align === "center" && "justify-center", className)}>
        {title}
      </div>
    );
  }

  const currentField = searchParams.get(fieldKey);
  const currentDir = searchParams.get(directionKey);
  const isActive = currentField === field;

  function handleSort() {
    const params = new URLSearchParams(searchParams);

    if (!isActive) {
      params.set(fieldKey, field);
      params.set(directionKey, "asc");
    } else if (currentDir === "asc") {
      params.set(directionKey, "desc");
    } else {
      params.delete(fieldKey);
      params.delete(directionKey);
    }

    // Reset to page 1 when sort changes
    params.delete("page");
    setSearchParams(params);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-3 h-8 hover:bg-transparent data-[state=open]:bg-transparent", className)}
      onClick={handleSort}
    >
      {title}
      {isActive && currentDir === "asc" ? (
        <ArrowUp className="ml-1 size-3.5" />
      ) : isActive && currentDir === "desc" ? (
        <ArrowDown className="ml-1 size-3.5" />
      ) : (
        <ArrowUpDown className="ml-1 size-3.5" />
      )}
    </Button>
  );
}
