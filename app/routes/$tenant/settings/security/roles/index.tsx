import { KeyRound, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { listRolesPaginated } from "~/services/roles.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { invariantResponse } from "~/utils/invariant";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Roles" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Roles" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "role", "read");
  const tenantId = user.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 10);
  const q = url.searchParams.get("q")?.trim() || "";

  const searchWhere = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const { items, totalCount } = await listRolesPaginated(tenantId, {
    where: searchWhere,
    page,
    pageSize,
  });
  const totalPages = Math.ceil(totalCount / pageSize);

  return data({
    roles: items,
    pagination: { page, pageSize, totalCount, totalPages } satisfies PaginationMeta,
  });
}

type RoleRow = Route.ComponentProps["loaderData"]["roles"][number];

export default function RolesListPage({ loaderData }: Route.ComponentProps) {
  const { roles, pagination } = loaderData;
  const base = useBasePrefix();
  const basePath = `${base}/settings/security/roles`;

  const columns: ColumnDef<RoleRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Shield className="text-muted-foreground size-4" />
          <Link to={`${basePath}/${row.id}`} className="hover:underline">
            {row.name}
          </Link>
        </div>
      ),
      cellClassName: "font-medium",
    },
    {
      id: "scope",
      header: "Scope",
      cell: (row) => <Badge variant="outline">{row.scope}</Badge>,
    },
    {
      id: "description",
      header: "Description",
      cell: (row) => row.description || "—",
      cellClassName: "text-muted-foreground",
    },
    {
      id: "permissions",
      header: "Permissions",
      align: "center",
      cell: (row) => (
        <span className="inline-flex items-center gap-1 text-sm">
          <KeyRound className="size-3" /> {row._count.rolePermissions}
        </span>
      ),
    },
    {
      id: "members",
      header: "Members",
      align: "center",
      cell: (row) => row._count.userRoles,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Roles</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Define access levels with scoped permission sets.
        </p>
      </div>

      <DataTable
        data={roles}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: "Search roles…" }}
        toolbarActions={[
          {
            label: "New role",
            icon: Plus,
            href: `${basePath}/new`,
            permission: "role:create",
          },
        ]}
        rowActions={[
          {
            label: "Edit",
            icon: Pencil,
            href: (row) => `${basePath}/${row.id}/edit`,
            permission: "role:update",
          },
          {
            label: "Permissions",
            icon: KeyRound,
            href: (row) => `${basePath}/${row.id}/permissions`,
          },
          {
            label: "Delete",
            icon: Trash2,
            href: (row) => `${basePath}/${row.id}/delete`,
            variant: "destructive",
            permission: "role:delete",
          },
        ]}
        pagination={pagination}
        emptyState={{
          icon: Shield,
          title: "No roles yet",
          description: "Create roles to group permissions and assign them to users.",
        }}
      />
    </div>
  );
}
