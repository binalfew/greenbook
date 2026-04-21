import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export interface ExportButtonProps {
  /**
   * Base URL of the export endpoint. The component appends `?format=csv|json`.
   * The endpoint is expected to respond with a file stream (`Content-Disposition:
   * attachment`) — the browser handles the download.
   */
  exportUrl: string;
  label?: string;
}

/**
 * Dropdown button that triggers a CSV or JSON export.
 *
 * Renders as a link (not a fetcher) so the browser's default download handling
 * picks up the streamed response. Consumers that need custom per-format URLs
 * can render their own button with the same visual pattern.
 */
export function ExportButton({ exportUrl, label }: ExportButtonProps) {
  const { t } = useTranslation("common");

  const join = (fmt: string) => `${exportUrl}${exportUrl.includes("?") ? "&" : "?"}format=${fmt}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="size-3.5" />
          {label ?? t("actions")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label ?? t("actions")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={join("csv")} download>
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={join("json")} download>
            JSON
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
