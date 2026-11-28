import {
  BriefcaseBusiness,
  Inbox,
  ListChecks,
  Network,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, data, useRouteLoaderData } from "react-router";
import { ModuleGrid } from "~/components/dashboard/module-grid";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getVisibleGroups, type Permission } from "~/config/navigation";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/index";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dashboard" }];
}

// A tenant with a directory gets the directory's counts as its dashboard; a
// tenant without one (the system tenant) gets the module launchpad.
export async function loader({ request, params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  const summary = { name: tenant.name, slug: tenant.slug };
  if (!(await isFeatureEnabled("FF_DIRECTORY", { tenantId: tenant.id }))) {
    return data({ tenant: summary, directory: null });
  }

  const { user, tenantId, canReview, canSubmit } = await requireDirectoryAccess(request);
  if (!hasPermission(user, "organization", "read")) {
    return data({ tenant: summary, directory: null });
  }

  const [orgCount, personCount, positionCount, pendingCount, myPendingCount] = await Promise.all([
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.person.count({ where: { tenantId, deletedAt: null } }),
    prisma.position.count({ where: { deletedAt: null, isActive: true } }),
    prisma.changeRequest.count({ where: { tenantId, status: "PENDING" } }),
    prisma.changeRequest.count({
      where: { tenantId, status: "PENDING", submittedById: user.id },
    }),
  ]);

  return data({
    tenant: summary,
    directory: {
      counts: { orgCount, personCount, positionCount, pendingCount, myPendingCount },
      canReview,
      canSubmit,
    },
  });
}

type LayoutData = {
  permissions: Permission[];
  enabledFeatures: Record<string, boolean>;
  isGlobalAdmin: boolean;
};

export default function TenantDashboard({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const layoutData = useRouteLoaderData("routes/$tenant/_layout") as LayoutData | undefined;
  const basePrefix = `/${params.tenant}`;
  const permissions = layoutData?.permissions ?? [];
  const enabledFeatures = layoutData?.enabledFeatures;
  const isGlobalAdmin = layoutData?.isGlobalAdmin ?? false;
  const navGroups = useMemo(
    () => getVisibleGroups(permissions, basePrefix, enabledFeatures, isGlobalAdmin),
    [permissions, basePrefix, enabledFeatures, isGlobalAdmin],
  );

  const { tenant, directory } = loaderData;
  if (!directory) return <ModuleGrid groups={navGroups} hideUrl={basePrefix} />;

  const { counts, canReview, canSubmit } = directory;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI
          to={`${basePrefix}/organogram`}
          icon={Network}
          label={t("kpi.organizations")}
          value={counts.orgCount}
        />
        <KPI
          to={`${basePrefix}/people`}
          icon={Users}
          label={t("kpi.people")}
          value={counts.personCount}
        />
        <KPI
          to={`${basePrefix}/positions`}
          icon={BriefcaseBusiness}
          label={t("kpi.positions")}
          value={counts.positionCount}
        />
        {canReview ? (
          <KPI
            to={`${basePrefix}/approvals`}
            icon={ListChecks}
            label={t("kpi.pendingChanges")}
            value={counts.pendingCount}
            emphasise={counts.pendingCount > 0}
          />
        ) : canSubmit ? (
          <KPI
            to={`${basePrefix}/submissions`}
            icon={Inbox}
            label={t("kpi.mySubmissions")}
            value={counts.myPendingCount}
          />
        ) : null}
      </div>
    </div>
  );
}

function KPI({
  to,
  icon: Icon,
  label,
  value,
  emphasise = false,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: number;
  emphasise?: boolean;
}) {
  return (
    <Link to={to} className="block">
      <Card className="hover:bg-muted/40 transition-colors">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
          <Icon className={emphasise ? "text-primary size-4" : "text-muted-foreground size-4"} />
        </CardHeader>
        <CardContent>
          <div
            className={emphasise ? "text-primary text-2xl font-semibold" : "text-2xl font-semibold"}
          >
            {value.toLocaleString()}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
