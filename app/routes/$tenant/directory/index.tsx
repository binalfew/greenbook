import { Building2, Inbox, Network, ScrollText, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { prisma } from "~/utils/db/db.server";
import { hasPermission, requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Overview" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user, tenantId } = await requireFeature(request, "FF_DIRECTORY");

  const [orgCount, personCount, positionCount, pendingCount, myPendingCount] = await Promise.all([
    prisma.organization.count({ where: { tenantId, deletedAt: null } }),
    prisma.person.count({ where: { tenantId, deletedAt: null } }),
    prisma.position.count({ where: { tenantId, deletedAt: null, isActive: true } }),
    prisma.changeRequest.count({ where: { tenantId, status: "PENDING" } }),
    prisma.changeRequest.count({
      where: { tenantId, status: "PENDING", submittedById: user.id },
    }),
  ]);

  return data({
    counts: { orgCount, personCount, positionCount, pendingCount, myPendingCount },
    canReview: hasPermission(user, "directory-change", "read-all"),
    canSubmit: hasPermission(user, "directory-change", "submit"),
  });
}

export default function DirectoryHome({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory`;
  const { counts, canReview, canSubmit } = loaderData;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI
          to={`${base}/organizations`}
          icon={Network}
          label={t("kpi.organizations")}
          value={counts.orgCount}
        />
        <KPI
          to={`${base}/people`}
          icon={Users}
          label={t("kpi.people")}
          value={counts.personCount}
        />
        <KPI
          to={`${base}/positions`}
          icon={Building2}
          label={t("kpi.positions")}
          value={counts.positionCount}
        />
        {canReview ? (
          <KPI
            to={`${base}/approvals`}
            icon={ScrollText}
            label={t("kpi.pendingChanges")}
            value={counts.pendingCount}
            emphasise={counts.pendingCount > 0}
          />
        ) : canSubmit ? (
          <KPI
            to={`${base}/submissions`}
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
  icon: typeof Building2;
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
