import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef } from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { listNotifications, markAllAsRead } from "~/services/notifications.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Notifications" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireFeature(request, "FF_NOTIFICATIONS");
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const status = url.searchParams.get("status");
  const result = await listNotifications(user.id, {
    page,
    perPage: 20,
    ...(status === "unread" && { read: false }),
    ...(status === "read" && { read: true }),
  });
  return data({
    notifications: result.notifications,
    total: result.total,
    page: result.page,
    perPage: result.perPage,
    totalPages: result.totalPages,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireFeature(request, "FF_NOTIFICATIONS");
  await markAllAsRead(user.id);
  return data({ ok: true });
}

type NotificationRow = Route.ComponentProps["loaderData"]["notifications"][number];

export default function NotificationsIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/notifications`;

  const columns: ColumnDef<NotificationRow>[] = [
    {
      id: "title",
      header: t("title"),
      cell: (row) => (
        <div className="flex items-start gap-2">
          {!row.read && <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" />}
          <div className="min-w-0">
            <p className={row.read ? "text-sm" : "text-sm font-medium"}>{row.title}</p>
            {row.message && <p className="text-muted-foreground truncate text-xs">{row.message}</p>}
          </div>
        </div>
      ),
    },
    {
      id: "type",
      header: t("type"),
      cell: (row) => (
        <Badge variant="secondary" className="font-mono text-xs">
          {row.type}
        </Badge>
      ),
      hideOnMobile: true,
    },
    {
      id: "createdAt",
      header: tc("created"),
      cell: (row) => new Date(row.createdAt).toLocaleString(),
      sortable: true,
      hideOnMobile: true,
    },
    {
      id: "status",
      header: tc("status"),
      cell: (row) => (row.read ? t("read") : t("unread")),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          {loaderData.total > 0 && (
            <p className="text-muted-foreground text-sm">
              {t("unreadCount", {
                count: loaderData.notifications.filter((n) => !n.read).length,
              })}
            </p>
          )}
        </div>
        <Form method="post">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={loaderData.notifications.every((n) => n.read)}
          >
            {t("markAllRead")}
          </Button>
        </Form>
      </div>

      <DataTable
        data={loaderData.notifications}
        columns={columns}
        rowKey="id"
        searchConfig={undefined}
        filters={[
          {
            paramKey: "status",
            label: tc("status"),
            placeholder: t("filterByStatus"),
            options: [
              { label: t("all"), value: "" },
              { label: t("unread"), value: "unread" },
              { label: t("read"), value: "read" },
            ],
          },
        ]}
        rowActions={[
          {
            label: t("markAsRead"),
            href: (row) => `${base}/${row.id}/read`,
            visible: (row) => !row.read,
          },
          {
            label: t("deleteNotification"),
            icon: Trash2,
            href: (row) => `${base}/${row.id}/delete`,
            variant: "destructive",
          },
        ]}
        pagination={{
          page: loaderData.page,
          pageSize: loaderData.perPage,
          totalCount: loaderData.total,
          totalPages: loaderData.totalPages,
        }}
        emptyState={{ title: t("empty") }}
      />
    </div>
  );
}
