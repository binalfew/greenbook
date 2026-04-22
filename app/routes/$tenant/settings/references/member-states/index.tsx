import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef } from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { listMemberStatesPaginated } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Member states" };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "read");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const search = url.searchParams.get("q") ?? undefined;

  const result = await listMemberStatesPaginated(tenantId, {
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

export default function MemberStatesIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/references/member-states`;

  const columns: ColumnDef<Row>[] = [
    {
      id: "fullName",
      header: t("fullName"),
      cell: (row) => (
        <a
          href={`${base}/${row.id}/edit`}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {row.fullName}
        </a>
      ),
    },
    {
      id: "abbreviation",
      header: t("abbreviation"),
      cell: (row) => <span className="font-mono text-xs">{row.abbreviation}</span>,
    },
    {
      id: "regions",
      header: t("regions"),
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.regions.map((r) => (
            <Badge key={r.regionalGroup.id} variant="outline" className="text-[10px]">
              {r.regionalGroup.code}
            </Badge>
          ))}
        </div>
      ),
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
        <h1 className="text-2xl font-semibold">{t("memberStates")}</h1>
      </header>

      <DataTable
        data={loaderData.items}
        columns={columns}
        rowKey="id"
        searchConfig={{ paramKey: "q", placeholder: t("fullName") }}
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
