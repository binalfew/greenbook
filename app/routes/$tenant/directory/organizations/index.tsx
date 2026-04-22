import { Network, Pencil, Plus, Trash2, TreePine } from "lucide-react";
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
import { prisma } from "~/utils/db/db.server";
import { listOrganizations } from "~/services/organizations.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Organizations" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user, tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "organization",
  });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const q = url.searchParams.get("q")?.trim() || "";
  const typeId = url.searchParams.get("typeId") || "";

  const [result, types] = await Promise.all([
    listOrganizations(tenantId, {
      where: {
        ...(q ? { search: q } : {}),
        ...(typeId ? { typeId } : {}),
      },
      page,
      pageSize,
    }),
    prisma.organizationType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, level: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return data({
    organizations: result.data,
    types,
    canWrite: canDirect,
    canDelete: hasPermission(user, "organization", "delete"),
    canSubmit,
    pagination: { page, pageSize, totalCount: result.total, totalPages } satisfies PaginationMeta,
  });
}

type OrgRow = Route.ComponentProps["loaderData"]["organizations"][number];

export default function OrganizationsIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { organizations, types, pagination, canWrite, canSubmit, canDelete } = loaderData;
  const base = `/${params.tenant}/directory/organizations`;

  const columns: ColumnDef<OrgRow>[] = [
    {
      id: "name",
      header: t("organizations.fields.name"),
      cell: (row) => (
        <Link to={`${base}/${row.id}`} className="font-medium underline-offset-4 hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      id: "acronym",
      header: t("organizations.fields.acronym"),
      cell: (row) => row.acronym ?? "—",
      cellClassName: "text-muted-foreground font-mono text-xs",
      hideOnMobile: true,
    },
    {
      id: "type",
      header: t("organizations.fields.type"),
      cell: (row) => <Badge variant="outline">{row.type.name}</Badge>,
      hideOnMobile: true,
    },
    {
      id: "parent",
      header: t("organizations.fields.parent"),
      cell: (row) => row.parent?.name ?? "—",
      hideOnMobile: true,
    },
  ];

  const filters: FilterDef[] = [
    {
      paramKey: "typeId",
      label: t("organizations.fields.type"),
      placeholder: t("organizations.fields.typePlaceholder"),
      options: types.map((ty) => ({ label: ty.name, value: ty.id })),
    },
  ];

  const canEdit = canWrite || canSubmit;
  const canDel = canDelete || canSubmit;

  const rowActions: RowAction<OrgRow>[] = [
    ...(canEdit
      ? [
          {
            label: tc("edit"),
            icon: Pencil,
            href: (row: OrgRow) => `${base}/${row.id}/edit`,
          },
        ]
      : []),
    ...(canDel
      ? [
          {
            label: tc("delete"),
            icon: Trash2,
            href: (row: OrgRow) => `${base}/${row.id}/delete`,
            variant: "destructive" as const,
          },
        ]
      : []),
  ];

  const toolbarActions: ToolbarAction[] = [
    {
      label: t("organizations.tree.viewTree"),
      icon: TreePine,
      href: `${base}/tree`,
      variant: "outline",
    },
    ...(canEdit ? [{ label: t("organizations.new"), icon: Plus, href: `${base}/new` }] : []),
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("organizations.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("organizations.subtitle")}</p>
      </header>

      <DataTable
        data={organizations}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: t("organizations.searchPlaceholder") }}
        filters={filters}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        pagination={pagination}
        emptyState={{
          icon: Network,
          title: t("organizations.emptyTitle"),
          description: t("organizations.emptyDescription"),
        }}
      />
    </div>
  );
}
