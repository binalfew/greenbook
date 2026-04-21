import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef } from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { listCountriesPaginated } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Countries" };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "read");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const search = url.searchParams.get("q") ?? undefined;

  const result = await listCountriesPaginated(tenantId, {
    page,
    pageSize: 25,
    where: { ...(search && { search }) },
  });

  return data({
    items: result.data,
    total: result.total,
    page,
    pageSize: 25,
    totalPages: Math.ceil(result.total / 25),
  });
}

type Row = Route.ComponentProps["loaderData"]["items"][number];

export default function CountriesIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/references/countries`;

  const columns: ColumnDef<Row>[] = [
    {
      id: "name",
      header: t("name"),
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.flag && <span className="text-lg">{row.flag}</span>}
          <a
            href={`${base}/${row.id}/edit`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {row.name}
          </a>
        </div>
      ),
    },
    {
      id: "code",
      header: t("code"),
      cell: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      id: "alpha3",
      header: t("alpha3"),
      cell: (row) => <span className="font-mono text-xs">{row.alpha3 ?? ""}</span>,
      hideOnMobile: true,
    },
    {
      id: "phoneCode",
      header: t("phoneCode"),
      cell: (row) => row.phoneCode ?? "",
      hideOnMobile: true,
    },
    {
      id: "isActive",
      header: t("isActive"),
      cell: (row) =>
        row.isActive ? (
          <Badge variant="default">{tc("yes")}</Badge>
        ) : (
          <Badge variant="outline">{tc("no")}</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("countries")}</h1>
      </header>

      <DataTable
        data={loaderData.items}
        columns={columns}
        rowKey="id"
        searchConfig={{ paramKey: "q", placeholder: t("name") }}
        toolbarActions={[{ label: t("new"), icon: Plus, href: `${base}/new` }]}
        rowActions={[
          { label: tc("edit"), icon: Pencil, href: (row) => `${base}/${row.id}/edit` },
          {
            label: tc("delete"),
            icon: Trash2,
            href: (row) => `${base}/${row.id}/delete`,
            variant: "destructive",
          },
        ]}
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
