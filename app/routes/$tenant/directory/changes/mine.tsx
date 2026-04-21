import { Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { useChangeColumns } from "~/components/directory/change-row-columns";
import { DataTable } from "~/components/data-table/data-table";
import type { FilterDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { listMyChanges } from "~/services/directory-changes.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/mine";

export const handle = { breadcrumb: "Mine" };

const STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  if (!canSubmit) throw new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const status = url.searchParams.get("status") || "";

  const result = await listMyChanges(tenantId, user.id, {
    where: { ...(status ? { status } : {}) },
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

export default function MyChanges({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { changes, pagination } = loaderData;
  const base = `/${params.tenant}/directory/changes`;

  const columns = useChangeColumns(base, [
    "entity",
    "operation",
    "status",
    "submittedAt",
    "reviewer",
  ]);

  const filters: FilterDef[] = [
    {
      paramKey: "status",
      label: t("changes.columns.status"),
      placeholder: t("changes.filters.allStatuses"),
      options: STATUS_VALUES.map((s) => ({
        label: t(`changes.statusLabel.${s}`),
        value: s,
      })),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("changes.mineTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("changes.mineSubtitle")}</p>
      </header>

      <DataTable
        data={changes}
        columns={columns}
        rowKey="id"
        filters={filters}
        pagination={pagination}
        emptyState={{
          icon: Inbox,
          title: t("changes.emptyMine"),
          description: t("changes.emptyMineDescription"),
        }}
      />
    </div>
  );
}
