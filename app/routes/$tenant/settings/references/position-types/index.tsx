import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef } from "~/components/data-table/data-table-types";
import { listPositionTypesPaginated } from "~/services/reference-data.server";
import { requireReferenceDataRead } from "~/utils/reference-data-access.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Position types" };

export async function loader({ request }: Route.LoaderArgs) {
  const { canEdit } = await requireReferenceDataRead(request);

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const search = url.searchParams.get("q") ?? undefined;

  const result = await listPositionTypesPaginated({
    page,
    pageSize: 25,
    where: { ...(search && { search }) },
  });

  return data({
    items: result.data,
    canEdit,
    total: result.total,
    page,
    pageSize: 25,
    totalPages: Math.ceil(result.total / 25),
  });
}

type Row = Route.ComponentProps["loaderData"]["items"][number];

export default function PositionTypesIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/references/position-types`;

  const columns: ColumnDef<Row>[] = [
    {
      id: "name",
      header: t("name"),
      cell: (row) =>
        loaderData.canEdit ? (
          <a
            href={`${base}/${row.id}/edit`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {row.name}
          </a>
        ) : (
          <span className="text-sm font-medium">{row.name}</span>
        ),
    },
    {
      id: "code",
      header: t("code"),
      cell: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      id: "hierarchyLevel",
      header: t("hierarchyLevel"),
      cell: (row) => row.hierarchyLevel ?? "—",
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("positionTypes")}</h1>
      </header>

      <DataTable
        data={loaderData.items}
        columns={columns}
        rowKey="id"
        searchConfig={{ paramKey: "q", placeholder: t("name") }}
        toolbarActions={
          loaderData.canEdit ? [{ label: t("new"), icon: Plus, href: `${base}/new` }] : []
        }
        rowActions={
          loaderData.canEdit
            ? [
                { label: tc("edit"), icon: Pencil, href: (row) => `${base}/${row.id}/edit` },
                {
                  label: tc("delete"),
                  icon: Trash2,
                  href: (row) => `${base}/${row.id}/delete`,
                  variant: "destructive",
                },
              ]
            : []
        }
        pagination={{
          page: loaderData.page,
          pageSize: loaderData.pageSize,
          totalCount: loaderData.total,
          totalPages: loaderData.totalPages,
        }}
        emptyState={{ title: t("empty"), description: t("emptyDescription") }}
      />
    </div>
  );
}
