import { Building2, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Link, data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef, PaginationMeta } from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import { listTenantsPaginatedWithCounts } from "~/services/tenants.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Tenants" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Tenants" }];
}

const PLAN_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  free: "outline",
  starter: "secondary",
  professional: "default",
  enterprise: "default",
};

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, "tenant", "read");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 10);
  const q = url.searchParams.get("q")?.trim() || "";

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const { items, meta } = await listTenantsPaginatedWithCounts({ where, page, pageSize });

  return data({
    tenants: items,
    pagination: {
      page: meta.page,
      pageSize: meta.pageSize,
      totalCount: meta.total,
      totalPages: meta.totalPages,
    } satisfies PaginationMeta,
  });
}

type TenantRow = Route.ComponentProps["loaderData"]["tenants"][number];

export default function TenantsListPage({ loaderData }: Route.ComponentProps) {
  const { tenants, pagination } = loaderData;
  const base = useBasePrefix();

  const columns: ColumnDef<TenantRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Building2 className="text-muted-foreground size-4 shrink-0" />
          <Link to={`${base}/tenants/${row.id}`} className="hover:underline">
            {row.name}
          </Link>
        </div>
      ),
      cellClassName: "font-medium text-foreground",
    },
    {
      id: "slug",
      header: "Slug",
      cell: (row) => (
        <Badge variant="outline" className="text-xs">
          /{row.slug}
        </Badge>
      ),
    },
    {
      id: "email",
      header: "Email",
      cell: "email",
      cellClassName: "text-muted-foreground",
      hideOnMobile: true,
    },
    {
      id: "plan",
      header: "Plan",
      cell: (row) => (
        <Badge variant={PLAN_VARIANT[row.subscriptionPlan] ?? "outline"} className="capitalize">
          {row.subscriptionPlan}
        </Badge>
      ),
    },
    {
      id: "users",
      header: "Users",
      align: "center",
      cell: (row) => (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
          {row._count.users}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      id: "roles",
      header: "Roles",
      align: "center",
      cell: (row) => (
        <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
          {row._count.roles}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      hideOnMobile: true,
      cellClassName: "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">Tenants</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage organizations and their subscription plans.
        </p>
      </div>

      <DataTable
        data={tenants}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: "Search tenants…" }}
        toolbarActions={[
          {
            label: "New tenant",
            icon: Plus,
            href: `${base}/tenants/new`,
            permission: "tenant:create",
          },
        ]}
        rowActions={[
          {
            label: "View",
            icon: Eye,
            href: (row) => `${base}/tenants/${row.id}`,
          },
          {
            label: "Edit",
            icon: Pencil,
            href: (row) => `${base}/tenants/${row.id}/edit`,
            permission: "tenant:update",
          },
          {
            label: "Delete",
            icon: Trash2,
            href: (row) => `${base}/tenants/${row.id}/delete`,
            variant: "destructive",
            permission: "tenant:delete",
          },
        ]}
        pagination={pagination}
        emptyState={{
          icon: Building2,
          title: "No tenants found",
          description: "Tenants will appear here once they are created.",
        }}
      />
    </div>
  );
}
