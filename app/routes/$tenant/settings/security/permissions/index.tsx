import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { listPermissionsPaginated } from "~/services/permissions.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Permissions" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Permissions" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, "permission", "read");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 10);
  const q = url.searchParams.get("q")?.trim() || "";
  const moduleFilter = url.searchParams.get("module") || "";
  const resourceFilter = url.searchParams.get("resource") || "";
  const actionFilter = url.searchParams.get("action") || "";

  const searchWhere = q
    ? {
        OR: [
          { resource: { contains: q, mode: "insensitive" as const } },
          { action: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const filterWhere = {
    ...(moduleFilter ? { module: moduleFilter } : {}),
    ...(resourceFilter ? { resource: resourceFilter } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
  };

  const andClauses = [searchWhere, filterWhere].filter((w) => Object.keys(w).length > 0);
  const combinedWhere = andClauses.length > 0 ? { AND: andClauses } : {};

  const [{ items, totalCount }, distinctModules, distinctResources, distinctActions] =
    await Promise.all([
      listPermissionsPaginated({ where: combinedWhere, page, pageSize }),
      prisma.permission.groupBy({ by: ["module"], orderBy: { module: "asc" } }),
      prisma.permission.groupBy({ by: ["resource"], orderBy: { resource: "asc" } }),
      prisma.permission.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
    ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return data({
    permissions: items,
    pagination: { page, pageSize, totalCount, totalPages } satisfies PaginationMeta,
    modules: distinctModules.map((m) => m.module),
    resources: distinctResources.map((r) => r.resource),
    actions: distinctActions.map((a) => a.action),
  });
}

type PermissionRow = Route.ComponentProps["loaderData"]["permissions"][number];

export default function PermissionsListPage({ loaderData }: Route.ComponentProps) {
  const { permissions, pagination, modules, resources, actions } = loaderData;
  const base = useBasePrefix();
  const basePath = `${base}/settings/security/permissions`;

  const columns: ColumnDef<PermissionRow>[] = [
    {
      id: "resource",
      header: "Resource",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <KeyRound className="text-muted-foreground size-4 shrink-0" />
          <Link to={`${basePath}/${row.id}`} className="hover:underline">
            {row.resource}
          </Link>
        </div>
      ),
      cellClassName: "font-medium",
    },
    {
      id: "action",
      header: "Action",
      cell: (row) => (
        <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium">
          {row.action}
        </span>
      ),
    },
    {
      id: "module",
      header: "Module",
      cell: (row) => (
        <Badge variant="outline" className="text-[10px] capitalize">
          {row.module}
        </Badge>
      ),
      hideOnMobile: true,
    },
    {
      id: "description",
      header: "Description",
      cell: (row) => row.description || "—",
      cellClassName: "text-muted-foreground max-w-xs truncate",
      hideOnMobile: true,
    },
    {
      id: "roles",
      header: "Roles",
      align: "center",
      cell: (row) => (
        <Badge variant="secondary" className="text-[10px]">
          {row._count.rolePermissions}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Permissions</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage the resource/action atoms that roles grant.
        </p>
      </div>

      <DataTable
        data={permissions}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: "Search permissions…" }}
        filters={[
          {
            paramKey: "module",
            label: "Module",
            placeholder: "All modules",
            options: modules.map((m) => ({
              label: m.charAt(0).toUpperCase() + m.slice(1),
              value: m,
            })),
          },
          {
            paramKey: "resource",
            label: "Resource",
            placeholder: "All resources",
            options: resources.map((r) => ({ label: r, value: r })),
          },
          {
            paramKey: "action",
            label: "Action",
            placeholder: "All actions",
            options: actions.map((a) => ({ label: a, value: a })),
          },
        ]}
        toolbarActions={[
          {
            label: "New permission",
            icon: Plus,
            href: `${basePath}/new`,
            permission: "permission:create",
          },
        ]}
        rowActions={[
          {
            label: "Edit",
            icon: Pencil,
            href: (row) => `${basePath}/${row.id}/edit`,
            permission: "permission:update",
          },
          {
            label: "Delete",
            icon: Trash2,
            href: (row) => `${basePath}/${row.id}/delete`,
            variant: "destructive",
            permission: "permission:delete",
          },
        ]}
        pagination={pagination}
        emptyState={{
          icon: KeyRound,
          title: "No permissions yet",
          description: "Add resource/action pairs to grant through roles.",
        }}
      />
    </div>
  );
}
