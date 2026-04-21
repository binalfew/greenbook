import { ChevronRight, CircleDollarSign, CircleUser, Globe, Languages } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { getReferenceDataCounts } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "References" };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "read");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  const counts = await getReferenceDataCounts(tenantId);
  return data({ counts });
}

function SurfaceCard({
  icon: Icon,
  title,
  value,
  description,
  to,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  value: string | number;
  description: string;
  to: string;
  accent: string;
}) {
  return (
    <Link
      to={to}
      className="group bg-card hover:border-primary/40 relative flex items-start gap-4 rounded-xl border p-4 transition-all hover:shadow-md"
    >
      <div
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${accent}`}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground text-xs font-medium tabular-nums">{value}</p>
        </div>
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{description}</p>
      </div>
      <ChevronRight className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export default function ReferencesIndex({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { counts } = loaderData;
  const base = `/${params.tenant}/settings/references`;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-foreground text-2xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("subtitle")}</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          {t("manageHeading")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SurfaceCard
            icon={Globe}
            title={t("countries")}
            value={counts.countries}
            description={t("countriesDescription")}
            to={`${base}/countries`}
            accent="bg-sky-500/10 text-sky-600 dark:text-sky-400"
          />
          <SurfaceCard
            icon={CircleUser}
            title={t("titles")}
            value={counts.titles}
            description={t("titlesDescription")}
            to={`${base}/titles`}
            accent="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          />
          <SurfaceCard
            icon={Languages}
            title={t("languages")}
            value={counts.languages}
            description={t("languagesDescription")}
            to={`${base}/languages`}
            accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <SurfaceCard
            icon={CircleDollarSign}
            title={t("currencies")}
            value={counts.currencies}
            description={t("currenciesDescription")}
            to={`${base}/currencies`}
            accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
        </div>
      </div>
    </div>
  );
}
