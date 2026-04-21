import { Activity, BarChart3, ClipboardList, Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data, useSearchParams } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type {
  ColumnDef,
  FilterDef,
  PaginationMeta,
} from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DatePicker } from "~/components/ui/date-picker";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Logs" };

// Curated list of action verbs the template emits. Apps MAY emit additional
// action strings; the filter list is just a convenience, not an enforcement.
const ACTION_TYPES = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "CONFIGURE",
  "TWO_FACTOR_ENABLE",
  "TWO_FACTOR_DISABLE",
  "IMPERSONATE_START",
  "IMPERSONATE_END",
  "IMPERSONATE_TIMEOUT",
  "PASSWORD_EXPIRED",
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "audit-log", "read");
  const tenantId = user.tenantId;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 50);
  const q = url.searchParams.get("q")?.trim() || "";
  const actionFilter = url.searchParams.get("action") || "";
  const entityTypeFilter = url.searchParams.get("entityType") || "";
  const userIdFilter = url.searchParams.get("userId") || "";
  const dateFromParam = url.searchParams.get("dateFrom") || "";
  const dateToParam = url.searchParams.get("dateTo") || "";

  const searchWhere = q
    ? {
        OR: [
          { description: { contains: q, mode: "insensitive" as const } },
          { entityType: { contains: q, mode: "insensitive" as const } },
          { ipAddress: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const filterWhere: Record<string, unknown> = {};
  if (actionFilter) filterWhere.action = actionFilter;
  if (entityTypeFilter) filterWhere.entityType = entityTypeFilter;
  if (userIdFilter) filterWhere.userId = userIdFilter;

  const dateWhere: Record<string, Date> = {};
  if (dateFromParam) dateWhere.gte = new Date(dateFromParam);
  if (dateToParam) dateWhere.lte = new Date(dateToParam + "T23:59:59");
  if (Object.keys(dateWhere).length) filterWhere.createdAt = dateWhere;

  const tenantWhere = tenantId ? { tenantId } : {};

  const andClauses = [tenantWhere, filterWhere, searchWhere].filter(
    (w) => Object.keys(w).length > 0,
  );
  const where = andClauses.length > 0 ? { AND: andClauses } : {};

  // CSV export
  if (url.searchParams.get("export") === "csv") {
    const allLogs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    const csv = [
      "Date,Action,Entity Type,Entity ID,Description,User,IP Address",
      ...allLogs.map((l) =>
        [
          l.createdAt.toISOString(),
          l.action,
          l.entityType,
          l.entityId ?? "",
          `"${(l.description ?? "").replace(/"/g, '""')}"`,
          l.userId ?? "System",
          l.ipAddress ?? "",
        ].join(","),
      ),
    ].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-logs-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  }

  const entityTypesRaw = await prisma.auditLog.groupBy({
    by: ["entityType"],
    where: tenantWhere,
    orderBy: { entityType: "asc" },
  });
  const entityTypes = entityTypesRaw.map((e) => e.entityType).filter(Boolean);

  const users = await prisma.user.findMany({
    where: tenantId ? { tenantId } : {},
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { firstName: "asc" },
  });

  // KPI stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [logs, totalCount, todayCount, weekDeleteCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { ...tenantWhere, createdAt: { gte: today } } }),
    prisma.auditLog.count({
      where: { ...tenantWhere, action: "DELETE", createdAt: { gte: weekAgo } },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return data({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      description: log.description,
      ipAddress: log.ipAddress,
      userName: log.userId ?? "System",
      actingAsUserId: log.actingAsUserId,
      createdAt: log.createdAt.toISOString(),
    })),
    pagination: { page, pageSize, totalCount, totalPages } satisfies PaginationMeta,
    entityTypes,
    users: users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim() || u.email,
    })),
    kpi: { todayCount, weekDeleteCount, totalCount },
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionBadgeVariant(action: string) {
  switch (action) {
    case "CREATE":
      return "default" as const;
    case "UPDATE":
    case "CONFIGURE":
      return "secondary" as const;
    case "DELETE":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

type LoaderResult = Exclude<Route.ComponentProps["loaderData"], Response>;
type LogRow = LoaderResult["logs"][number];

function DateRangeFilter() {
  const { t } = useTranslation("logs");
  const [searchParams, setSearchParams] = useSearchParams();
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  function formatLocalDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function handleChange(key: "dateFrom" | "dateTo", date: Date | undefined) {
    const next = new URLSearchParams(searchParams);
    if (date) {
      next.set(key, formatLocalDate(date));
    } else {
      next.delete(key);
    }
    next.delete("page");
    setSearchParams(next);
  }

  function handleClear() {
    const next = new URLSearchParams(searchParams);
    next.delete("dateFrom");
    next.delete("dateTo");
    next.delete("page");
    setSearchParams(next);
  }

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
      <div className="w-full sm:w-auto sm:min-w-[180px]">
        <DatePicker
          placeholder={t("fromDate")}
          value={dateFrom ? new Date(dateFrom + "T00:00:00") : undefined}
          onChange={(d) => handleChange("dateFrom", d)}
        />
      </div>
      <div className="w-full sm:w-auto sm:min-w-[180px]">
        <DatePicker
          placeholder={t("toDate")}
          value={dateTo ? new Date(dateTo + "T00:00:00") : undefined}
          onChange={(d) => handleChange("dateTo", d)}
        />
      </div>
      {hasDateFilter && (
        <Button variant="ghost" size="sm" onClick={handleClear} className="w-full sm:w-auto">
          {t("clearDates")}
        </Button>
      )}
    </div>
  );
}

export default function AuditLogsPage({ loaderData, params }: Route.ComponentProps) {
  // CSV responses are returned before render; narrow here.
  if (!loaderData || !("logs" in loaderData)) return null;

  const { t } = useTranslation("logs");
  const { logs, pagination, entityTypes, users, kpi } = loaderData;
  const [searchParams] = useSearchParams();
  const basePrefix = `/${params.tenant}/logs`;

  const exportParams = new URLSearchParams(searchParams);
  exportParams.set("export", "csv");
  const exportUrl = `${basePrefix}?${exportParams.toString()}`;

  const columns: ColumnDef<LogRow>[] = [
    {
      id: "createdAt",
      header: t("date"),
      cell: (row) => (
        <Link to={`${basePrefix}/${row.id}`} className="text-primary hover:underline">
          {formatDate(row.createdAt)}
        </Link>
      ),
      sortable: true,
      cellClassName: "whitespace-nowrap",
    },
    {
      id: "action",
      header: t("action"),
      cell: (row) => <Badge variant={actionBadgeVariant(row.action)}>{row.action}</Badge>,
    },
    {
      id: "entityType",
      header: t("entityType"),
      cell: (row) => row.entityType,
    },
    {
      id: "description",
      header: t("description"),
      cell: (row) => (
        <Link
          to={`${basePrefix}/${row.id}`}
          className="text-primary block max-w-xs truncate hover:underline"
        >
          {row.description ?? "\u2014"}
        </Link>
      ),
      cellClassName: "max-w-xs",
      hideOnMobile: true,
    },
    {
      id: "userName",
      header: t("user"),
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          {row.userName}
          {row.actingAsUserId && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]">
              {t("impersonating")}
            </Badge>
          )}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      id: "ipAddress",
      header: t("ipAddress"),
      cell: (row) => row.ipAddress ?? "\u2014",
      cellClassName: "text-muted-foreground",
      hideOnMobile: true,
    },
  ];

  const filters: FilterDef[] = [
    {
      paramKey: "action",
      label: t("action"),
      placeholder: t("allActions"),
      options: ACTION_TYPES.map((a) => ({ label: a, value: a })),
    },
    {
      paramKey: "entityType",
      label: t("entityType"),
      placeholder: t("allEntityTypes"),
      options: entityTypes.map((et) => ({ label: et, value: et })),
    },
    {
      paramKey: "userId",
      label: t("user"),
      placeholder: t("allUsers"),
      options: users.map((u) => ({ label: u.name, value: u.id })),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpiToday")}</CardTitle>
            <Activity className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpi.todayCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpiDeletes")}</CardTitle>
            <Trash2 className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpi.weekDeleteCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpiTotal")}</CardTitle>
            <BarChart3 className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpi.totalCount}</div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={logs}
        columns={columns}
        searchConfig={{ placeholder: t("searchLogs") }}
        filters={filters}
        toolbarActions={[
          {
            label: t("exportCsv"),
            icon: Download,
            href: exportUrl,
            variant: "outline",
          },
        ]}
        toolbarExtra={<DateRangeFilter />}
        pagination={pagination}
        emptyState={{
          icon: ClipboardList,
          title: t("noLogs"),
          description: t("noLogsDescription"),
        }}
      />
    </div>
  );
}
