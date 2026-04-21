import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef } from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { listWebhookSubscriptions } from "~/services/webhooks.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Webhooks" };

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_WEBHOOKS");
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const result = await listWebhookSubscriptions(tenantId, { page, pageSize: 20 });
  return data({
    items: result.items,
    meta: result.meta,
  });
}

type SubscriptionRow = Route.ComponentProps["loaderData"]["items"][number];

export default function WebhooksIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("webhooks");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/webhooks`;

  const statusBadge = (status: string) => {
    const variant =
      status === "ACTIVE" ? "default" : status === "PAUSED" ? "secondary" : "destructive";
    const label =
      status === "ACTIVE"
        ? t("statusActive")
        : status === "PAUSED"
          ? t("statusPaused")
          : status === "DISABLED"
            ? t("statusDisabled")
            : t("statusSuspended");
    return <Badge variant={variant}>{label}</Badge>;
  };

  const columns: ColumnDef<SubscriptionRow>[] = [
    {
      id: "url",
      header: t("url"),
      cell: (row) => (
        <div className="min-w-0">
          <a
            href={`${base}/${row.id}`}
            className="truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {row.url}
          </a>
          {row.description && (
            <p className="text-muted-foreground truncate text-xs">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "events",
      header: t("events"),
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.events.slice(0, 3).map((e) => (
            <Badge key={e} variant="secondary" className="font-mono text-[10px]">
              {e}
            </Badge>
          ))}
          {row.events.length > 3 && (
            <Badge variant="outline" className="text-[10px]">
              +{row.events.length - 3}
            </Badge>
          )}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      id: "status",
      header: tc("status"),
      cell: (row) => statusBadge(row.status),
    },
    {
      id: "createdAt",
      header: tc("created"),
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <DataTable
        data={loaderData.items}
        columns={columns}
        rowKey="id"
        toolbarActions={[
          {
            label: t("new"),
            icon: Plus,
            href: `${base}/new`,
          },
        ]}
        rowActions={[
          {
            label: tc("edit"),
            href: (row) => `${base}/${row.id}/edit`,
          },
          {
            label: t("deleteSubscription"),
            icon: Trash2,
            href: (row) => `${base}/${row.id}/delete`,
            variant: "destructive",
          },
        ]}
        pagination={{
          page: loaderData.meta.page,
          pageSize: loaderData.meta.pageSize,
          totalCount: loaderData.meta.total,
          totalPages: loaderData.meta.totalPages,
        }}
        emptyState={{ title: t("empty"), description: t("emptyDescription") }}
      />
    </div>
  );
}
