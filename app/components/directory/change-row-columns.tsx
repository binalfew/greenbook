import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChangeStatusPill } from "~/components/directory/change-status-pill";
import { Badge } from "~/components/ui/badge";
import type { ColumnDef } from "~/components/data-table/data-table-types";
import type { ChangeListRow } from "~/services/directory-changes.server";
import { formatDate } from "~/utils/format-date";

export type ChangeRow = ChangeListRow;

// Build column config for the three change-list views. Each caller picks
// which columns to include via the `columns` argument — pending/mine/history
// share the core columns but want different surface treatments.

export type ColumnKey =
  | "entity"
  | "operation"
  | "submitter"
  | "submittedAt"
  | "reviewer"
  | "reviewedAt"
  | "status";

export function useChangeColumns(base: string, keys: ColumnKey[]): ColumnDef<ChangeRow>[] {
  const { t } = useTranslation("directory");

  const all: Record<ColumnKey, ColumnDef<ChangeRow>> = {
    entity: {
      id: "entity",
      header: t("changes.columns.entity"),
      cell: (row) => (
        <div className="min-w-0">
          <Link to={`${base}/${row.id}`} className="font-medium underline-offset-4 hover:underline">
            {t(`changes.entityLabel.${row.entityType}`)}
          </Link>
          {row.entityId ? (
            <div className="text-muted-foreground truncate text-[10px]">{row.entityId}</div>
          ) : null}
        </div>
      ),
    },
    operation: {
      id: "operation",
      header: t("changes.columns.operation"),
      cell: (row) => (
        <Badge variant="outline">{t(`changes.operationLabel.${row.operation}`)}</Badge>
      ),
      hideOnMobile: true,
    },
    submitter: {
      id: "submitter",
      header: t("changes.columns.submitter"),
      cell: (row) => {
        const name = `${row.submittedBy.firstName} ${row.submittedBy.lastName}`.trim();
        return name || row.submittedBy.email;
      },
      hideOnMobile: true,
    },
    submittedAt: {
      id: "submittedAt",
      header: t("changes.columns.submittedAt"),
      cell: (row) => formatDate(row.submittedAt),
      cellClassName: "text-muted-foreground",
      hideOnMobile: true,
    },
    reviewer: {
      id: "reviewer",
      header: t("changes.columns.reviewer"),
      cell: (row) => {
        if (!row.reviewedBy) return "—";
        const name = `${row.reviewedBy.firstName} ${row.reviewedBy.lastName}`.trim();
        const base = name || row.reviewedBy.email;
        return row.approvalMode === "SELF_APPROVED"
          ? `${base} (${row.approvalMode.toLowerCase()})`
          : base;
      },
      hideOnMobile: true,
    },
    reviewedAt: {
      id: "reviewedAt",
      header: t("changes.columns.reviewedAt"),
      cell: (row) => (row.reviewedAt ? formatDate(row.reviewedAt) : "—"),
      cellClassName: "text-muted-foreground",
      hideOnMobile: true,
    },
    status: {
      id: "status",
      header: t("changes.columns.status"),
      cell: (row) => <ChangeStatusPill status={row.status} />,
    },
  };

  return keys.map((k) => all[k]);
}
