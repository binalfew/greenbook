import { Pencil, Plus, Trash2, Users } from "lucide-react";
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
import { listPeople } from "~/services/people.server";
import { prisma } from "~/utils/db/db.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "People" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user, tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "person",
  });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 25);
  const q = url.searchParams.get("q")?.trim() || "";
  const memberStateId = url.searchParams.get("memberStateId") || "";

  const [result, memberStates] = await Promise.all([
    listPeople(tenantId, {
      where: {
        ...(q ? { search: q } : {}),
        ...(memberStateId ? { memberStateId } : {}),
      },
      page,
      pageSize,
    }),
    prisma.memberState.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, abbreviation: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return data({
    people: result.data,
    memberStates,
    canWrite: canDirect,
    canDelete: hasPermission(user, "person", "delete"),
    canSubmit,
    pagination: { page, pageSize, totalCount: result.total, totalPages } satisfies PaginationMeta,
  });
}

type PersonRow = Route.ComponentProps["loaderData"]["people"][number];

export default function PeopleIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const { people, memberStates, pagination, canWrite, canSubmit, canDelete } = loaderData;
  const base = `/${params.tenant}/directory/people`;

  const columns: ColumnDef<PersonRow>[] = [
    {
      id: "name",
      header: t("people.fields.lastName"),
      cell: (row) => {
        const name = `${row.firstName} ${row.lastName}`.trim();
        return (
          <div className="min-w-0">
            <Link
              to={`${base}/${row.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.honorific ? `${row.honorific} ` : ""}
              {name}
            </Link>
            {row.email ? <div className="text-muted-foreground text-xs">{row.email}</div> : null}
          </div>
        );
      },
    },
    {
      id: "memberState",
      header: t("people.fields.memberState"),
      cell: (row) =>
        row.memberState ? <Badge variant="outline">{row.memberState.abbreviation}</Badge> : "—",
      hideOnMobile: true,
    },
    {
      id: "current",
      header: t("people.currentPosition"),
      cell: (row) =>
        row._count.assignments > 0 ? (
          <Badge variant="default">{row._count.assignments}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      cellClassName: "text-center",
      hideOnMobile: true,
    },
  ];

  const filters: FilterDef[] = [
    {
      paramKey: "memberStateId",
      label: t("people.fields.memberState"),
      placeholder: t("people.fields.memberStatePlaceholder"),
      options: memberStates.map((m) => ({ label: m.fullName, value: m.id })),
    },
  ];

  const canEdit = canWrite || canSubmit;
  const canDel = canDelete || canSubmit;

  const rowActions: RowAction<PersonRow>[] = [
    ...(canEdit
      ? [
          {
            label: tc("edit"),
            icon: Pencil,
            href: (row: PersonRow) => `${base}/${row.id}/edit`,
          },
        ]
      : []),
    ...(canDel
      ? [
          {
            label: tc("delete"),
            icon: Trash2,
            href: (row: PersonRow) => `${base}/${row.id}/delete`,
            variant: "destructive" as const,
          },
        ]
      : []),
  ];

  const toolbarActions: ToolbarAction[] = canEdit
    ? [{ label: t("people.new"), icon: Plus, href: `${base}/new` }]
    : [];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("people.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("people.subtitle")}</p>
      </header>

      <DataTable
        data={people}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: t("people.searchPlaceholder") }}
        filters={filters}
        toolbarActions={toolbarActions}
        rowActions={rowActions}
        pagination={pagination}
        emptyState={{
          icon: Users,
          title: t("people.emptyTitle"),
          description: t("people.emptyDescription"),
        }}
      />
    </div>
  );
}
