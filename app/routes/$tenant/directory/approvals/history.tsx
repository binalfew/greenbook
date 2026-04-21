import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { useChangeColumns } from "~/components/directory/change-row-columns";
import { DataTable } from "~/components/data-table/data-table";
import type { FilterDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { listChangeHistory } from "~/services/directory-changes.server";
import { directoryEntityValues } from "~/utils/schemas/directory";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/history";

export const handle = { breadcrumb: "History" };

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId, canReview } = await requireDirectoryAccess(request);
  if (!canReview) throw new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const entityType = url.searchParams.get("entityType") || "";

  const result = await listChangeHistory(tenantId, {
    where: { ...(entityType ? { entityType } : {}) },
    page,
    pageSize,
  });

  return data({
    changes: result.data,
    pagination: {
      page,
      pageSize,
      totalCount: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    } satisfies PaginationMeta,
  });
}

export default function ChangeHistory({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { changes, pagination } = loaderData;
  const base = `/${params.tenant}/directory/approvals`;

  const columns = useChangeColumns(base, [
    "entity",
    "operation",
    "status",
    "submitter",
    "reviewer",
    "reviewedAt",
  ]);

  const filters: FilterDef[] = [
    {
      paramKey: "entityType",
      label: t("changes.columns.entity"),
      placeholder: t("changes.filters.allEntities"),
      options: directoryEntityValues.map((e) => ({
        label: t(`changes.entityLabel.${e}`),
        value: e,
      })),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("changes.historyTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("changes.historySubtitle")}</p>
      </header>

      <DataTable
        data={changes}
        columns={columns}
        rowKey="id"
        filters={filters}
        pagination={pagination}
        emptyState={{
          icon: ScrollText,
          title: t("changes.emptyHistory"),
          description: t("changes.emptyHistoryDescription"),
        }}
      />
    </div>
  );
}
