import { Mail, Pencil, Plus, Shield, Trash2, User, Users } from "lucide-react";
import { Link, data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { listUsersPaginated } from "~/services/users.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { invariantResponse } from "~/utils/invariant";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Users" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Users" }];
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  INACTIVE: "bg-gray-100 text-gray-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  LOCKED: "bg-red-100 text-red-800",
};

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "user", "read");
  const tenantId = user.tenantId;
  invariantResponse(tenantId, "Missing tenant context", { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 10);
  const q = url.searchParams.get("q")?.trim() || "";

  const searchWhere = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const { items, totalCount } = await listUsersPaginated(tenantId, {
    where: searchWhere,
    page,
    pageSize,
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  return data({
    users: items,
    pagination: { page, pageSize, totalCount, totalPages } satisfies PaginationMeta,
  });
}

type UserRow = Route.ComponentProps["loaderData"]["users"][number];

export default function UsersListPage({ loaderData }: Route.ComponentProps) {
  const { users, pagination } = loaderData;
  const base = useBasePrefix();
  const basePath = `${base}/settings/security/users`;

  const columns: ColumnDef<UserRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: (row) => {
        const name = `${row.firstName} ${row.lastName}`.trim();
        return (
          <div className="flex items-center gap-2">
            <User className="text-muted-foreground size-4 shrink-0" />
            <Link to={`${basePath}/${row.id}`} className="hover:underline">
              {name || <span className="text-muted-foreground italic">No name</span>}
            </Link>
          </div>
        );
      },
      cellClassName: "font-medium text-foreground",
    },
    {
      id: "email",
      header: "Email",
      cell: "email",
      cellClassName: "text-muted-foreground",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => {
        const code = row.userStatus?.code ?? "—";
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              STATUS_COLORS[code] ?? "bg-gray-100 text-gray-800"
            }`}
          >
            {code}
          </span>
        );
      },
    },
    {
      id: "roles",
      header: "Roles",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.userRoles.length === 0 ? (
            <span className="text-muted-foreground text-xs italic">None</span>
          ) : (
            row.userRoles.map((ur) => (
              <span
                key={ur.id}
                className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
              >
                {ur.role.name}
              </span>
            ))
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Users</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage user accounts and their role assignments.
        </p>
      </div>

      <DataTable
        data={users}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: "Search users…" }}
        toolbarActions={[
          {
            label: "Invite user",
            icon: Mail,
            href: `${basePath}/invite`,
            variant: "outline",
            permission: "user:create",
          },
          {
            label: "New user",
            icon: Plus,
            href: `${basePath}/new`,
            permission: "user:create",
          },
        ]}
        rowActions={[
          {
            label: "Edit",
            icon: Pencil,
            href: (row) => `${basePath}/${row.id}/edit`,
            permission: "user:update",
          },
          {
            label: "Roles",
            icon: Shield,
            href: (row) => `${basePath}/${row.id}/roles`,
          },
          {
            label: "Delete",
            icon: Trash2,
            href: (row) => `${basePath}/${row.id}/delete`,
            variant: "destructive",
            permission: "user:delete",
          },
        ]}
        pagination={pagination}
        emptyState={{
          icon: Users,
          title: "No users yet",
          description: "Add users or send email invitations to get started.",
        }}
      />
    </div>
  );
}
