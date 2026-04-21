import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type {
  ColumnDef,
  FilterDef,
  PaginationMeta,
  RowAction,
  ToolbarAction,
} from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { listPositions } from "~/services/positions.server";
import { prisma } from "~/utils/db/db.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Positions" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user, tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "position",
  });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const q = url.searchParams.get("q")?.trim() || "";
  const organizationId = url.searchParams.get("organizationId") || "";
  const typeId = url.searchParams.get("typeId") || "";
  const activeParam = url.searchParams.get("isActive");
  const isActive = activeParam === "true" ? true : activeParam === "false" ? false : undefined;

  const [result, organizations, types] = await Promise.all([
    listPositions(tenantId, {
      where: {
        ...(q ? { search: q } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(typeId ? { typeId } : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
      },
      page,
      pageSize,
    }),
    prisma.organization.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, acronym: true },
    }),
    prisma.positionType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ hierarchyLevel: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return data({
    positions: result.data,
    organizations,
    types,
    canWrite: canDirect,
    canDelete: hasPermission(user, "position", "delete"),
    canSubmit,
    pagination: { page, pageSize, totalCount: result.total, totalPages } satisfies PaginationMeta,
  });
}

type PositionRow = Route.ComponentProps["loaderData"]["positions"][number];

export default function PositionsIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { positions, organizations, types, pagination, canWrite, canSubmit, canDelete } =
    loaderData;
  const base = `/${params.tenant}/directory/positions`;

  const columns: ColumnDef<PositionRow>[] = [
    {
      id: "title",
      header: t("positions.fields.title"),
      cell: (row) => (
        <div className="min-w-0">
          <Link to={`${base}/${row.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.title}
          </Link>
          {!row.isActive ? (
            <div>
              <Badge variant="outline" className="text-[10px]">
                {t("status.inactive")}
              </Badge>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "organization",
      header: t("positions.fields.organization"),
      cell: (row) => row.organization.acronym || row.organization.name,
      hideOnMobile: true,
    },
    {
      id: "type",
      header: t("positions.fields.type"),
      cell: (row) => <Badge variant="secondary">{row.type.name}</Badge>,
      hideOnMobile: true,
    },
    {
      id: "holders",
      header: t("positions.currentHolder"),
      cell: (row) =>
        row._count.assignments > 0 ? (
          <Badge variant="default">●</Badge>
        ) : (
          <Badge variant="outline">{t("positions.noCurrentHolder")}</Badge>
        ),
      hideOnMobile: true,
    },
  ];

  const filters: FilterDef[] = [
    {
      paramKey: "organizationId",
      label: t("positions.fields.organization"),
      placeholder: t("positions.fields.organizationPlaceholder"),
      options: organizations.map((o) => ({
        label: o.acronym ? `${o.name} (${o.acronym})` : o.name,
        value: o.id,
      })),
    },
    {
      paramKey: "typeId",
      label: t("positions.fields.type"),
      placeholder: t("positions.fields.typePlaceholder"),
      options: types.map((ty) => ({ label: ty.name, value: ty.id })),
    },
  ];

  const canEdit = canWrite || canSubmit;
  const canDel = canDelete || canSubmit;

  const rowActions: RowAction<PositionRow>[] = [
    ...(canEdit
      ? [
          {
            label: tc("edit"),
            icon: Pencil,
            href: (row: PositionRow) => `${base}/${row.id}/edit`,
          },
        ]
      : []),
    ...(canDel
      ? [
          {
            label: tc("delete"),
            icon: Trash2,
            href: (row: PositionRow) => `${base}/${row.id}/delete`,
            variant: "destructive" as const,
          },
        ]
      : []),
  ];

  const toolbarActions: ToolbarAction[] = canEdit
    ? [{ label: t("positions.new"), icon: Plus, href: `${base}/new` }]
    : [];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("positions.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("positions.subtitle")}</p>
      </header>

      <DataTable
        data={positions}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: t("positions.searchPlaceholder") }}
        filters={filters}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        pagination={pagination}
        emptyState={{
          icon: Building2,
          title: t("positions.emptyTitle"),
          description: t("positions.emptyDescription"),
        }}
      />
    </div>
  );
}
