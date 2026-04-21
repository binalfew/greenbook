import { Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { DataTable } from "~/components/data-table/data-table";
import type { ColumnDef, FilterDef } from "~/components/data-table/data-table-types";
import { Badge } from "~/components/ui/badge";
import { getSSOConfigurations } from "~/services/sso.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "SSO" };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "sso", "read");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const protocol = url.searchParams.get("protocol") || undefined;
  const status = url.searchParams.get("status") || undefined;

  const [configs, connectionCounts] = await Promise.all([
    getSSOConfigurations(tenantId),
    prisma.sSOConnection.groupBy({
      by: ["provider"],
      where: { tenantId },
      _count: true,
    }),
  ]);

  const countMap = new Map(connectionCounts.map((c) => [c.provider, c._count]));

  let filtered = configs.map((config) => ({
    ...config,
    connectionCount: countMap.get(config.provider) ?? 0,
  }));

  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.displayName?.toLowerCase().includes(lower) ||
        c.provider.toLowerCase().includes(lower) ||
        c.issuerUrl?.toLowerCase().includes(lower),
    );
  }
  if (protocol) {
    filtered = filtered.filter((c) => c.protocol === protocol);
  }
  if (status) {
    filtered = filtered.filter((c) => (status === "active" ? c.isActive : !c.isActive));
  }

  return data({ configs: filtered });
}

type SSORow = Route.ComponentProps["loaderData"]["configs"][number];

const STATUS_VARIANTS: Record<string, "default" | "secondary"> = {
  true: "default",
  false: "secondary",
};

export default function SSOListPage({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("sso");
  const { t: tc } = useTranslation("common");
  const { configs } = loaderData;
  const base = `/${params.tenant}/settings/security/sso`;

  const columns: ColumnDef<SSORow>[] = [
    {
      id: "displayName",
      header: t("provider"),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Shield className="text-muted-foreground size-4 shrink-0" />
          <Link to={`${base}/${row.id}`} className="hover:underline">
            {row.displayName || row.provider}
          </Link>
        </div>
      ),
      cellClassName: "font-medium text-foreground",
    },
    {
      id: "provider",
      header: t("type"),
      cell: (row) => <Badge variant="secondary">{row.provider.replace("_", " ")}</Badge>,
    },
    {
      id: "protocol",
      header: t("protocol"),
      cell: (row) => <Badge variant="outline">{row.protocol}</Badge>,
    },
    {
      id: "status",
      header: t("status"),
      cell: (row) => (
        <Badge variant={STATUS_VARIANTS[String(row.isActive)]}>
          {row.isActive ? t("active") : t("inactive")}
        </Badge>
      ),
    },
    {
      id: "enforceSSO",
      header: t("enforce"),
      cell: (row) =>
        row.enforceSSO ? (
          <Badge variant="outline">{t("required")}</Badge>
        ) : (
          <span className="text-muted-foreground">{t("optional")}</span>
        ),
      hideOnMobile: true,
    },
    {
      id: "connectionCount",
      header: t("linkedUsers"),
      cell: (row) => <span className="text-muted-foreground">{row.connectionCount}</span>,
      hideOnMobile: true,
    },
  ];

  const filters: FilterDef[] = [
    {
      paramKey: "protocol",
      label: t("protocol"),
      placeholder: t("allProtocols"),
      options: [
        { label: "OIDC", value: "OIDC" },
        { label: "SAML", value: "SAML" },
      ],
    },
    {
      paramKey: "status",
      label: t("status"),
      placeholder: t("allStatuses"),
      options: [
        { label: t("active"), value: "active" },
        { label: t("inactive"), value: "inactive" },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <DataTable
        data={configs}
        columns={columns}
        rowKey="id"
        searchConfig={{ placeholder: t("searchProviders") }}
        filters={filters}
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
            icon: Pencil,
            href: (row) => `${base}/${row.id}/edit`,
          },
          {
            label: tc("delete"),
            icon: Trash2,
            href: (row) => `${base}/${row.id}/delete`,
            variant: "destructive",
          },
        ]}
        emptyState={{
          icon: Shield,
          title: t("empty"),
          description: t("emptyDescription"),
        }}
      />
    </div>
  );
}
