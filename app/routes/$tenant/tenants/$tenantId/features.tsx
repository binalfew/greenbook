import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data, useFetcher } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useBasePrefix } from "~/hooks/use-base-prefix";
import {
  NotATenantFlagError,
  listTenantFeatures,
  setTenantFeature,
} from "~/services/tenant-features.server";
import { getTenantById } from "~/services/tenants.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { requireGlobalAdmin } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/features";

export const handle = { breadcrumb: "Features" };

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.tenant?.name ? `${data.tenant.name} features` : "Tenant features" }];
}

// Tenant management is global-admin-only (policy).
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireGlobalAdmin(request);

  const tenant = await getTenantById(params.tenantId);
  if (!tenant) {
    throw data({ error: "Tenant not found" }, { status: 404 });
  }
  return data({
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    flags: await listTenantFeatures(tenant.id),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireGlobalAdmin(request);

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const tenant = await getTenantById(params.tenantId);
  if (!tenant) {
    throw data({ error: "Tenant not found" }, { status: 404 });
  }

  const flagKey = formData.get("flagKey");
  const enabled = formData.get("enabled");
  if (typeof flagKey !== "string" || (enabled !== "true" && enabled !== "false")) {
    return data({ ok: false as const, error: "Invalid request" }, { status: 400 });
  }

  try {
    await setTenantFeature(
      tenant.id,
      flagKey,
      enabled === "true",
      buildServiceContext(request, user, tenant.id),
    );
  } catch (error) {
    if (error instanceof NotATenantFlagError) {
      return data({ ok: false as const, error: error.message }, { status: 400 });
    }
    throw error;
  }

  return data({ ok: true as const });
}

type Flag = Route.ComponentProps["loaderData"]["flags"][number];

export default function TenantFeaturesPage({ loaderData }: Route.ComponentProps) {
  const { tenant, flags } = loaderData;
  const basePrefix = useBasePrefix();
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-foreground text-2xl font-bold">
            {t("tenantFeaturesTitle", { name: tenant.name })}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("tenantFeaturesSubtitle")}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`${basePrefix}/tenants/${tenant.id}`}>{tCommon("back")}</Link>
        </Button>
      </div>

      {flags.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("tenantFeaturesEmpty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {flags.map((flag) => (
            <TenantFeatureCard key={flag.key} flag={flag} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TenantFeatureCard({ flag }: { flag: Flag }) {
  const fetcher = useFetcher<typeof action>({ key: `tenant-flag-${flag.key}` });
  const { t } = useTranslation("settings");
  // Show the requested state while the change is in flight.
  const isEnabled = fetcher.formData ? fetcher.formData.get("enabled") === "true" : flag.enabled;
  const label = t(`tenantFlag_${flag.key}`, { defaultValue: flag.key });

  return (
    <li
      className={`rounded-lg border p-4 transition-colors ${
        isEnabled ? "border-primary/30 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEnabled ? (
              <Check className="text-primary size-4 shrink-0" />
            ) : (
              <X className="text-muted-foreground/40 size-4 shrink-0" />
            )}
            <p className="text-sm font-medium">{label}</p>
            <Badge variant={isEnabled ? "default" : "secondary"} className="text-[10px]">
              {isEnabled ? t("stateEnabled") : t("stateDisabled")}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 pl-6 text-xs">
            {t(`tenantFlagHelp_${flag.key}`, {
              defaultValue: flag.description ?? t("noDescription"),
            })}
          </p>
          <p className="text-muted-foreground mt-2 pl-6 font-mono text-[10px]">{flag.key}</p>
        </div>
        <fetcher.Form method="post">
          <AuthenticityTokenInput />
          <input type="hidden" name="flagKey" value={flag.key} />
          <input type="hidden" name="enabled" value={String(!isEnabled)} />
          <Button
            type="submit"
            size="sm"
            variant={isEnabled ? "outline" : "default"}
            disabled={fetcher.state !== "idle"}
            aria-label={t(isEnabled ? "tenantFeatureDisableLabel" : "tenantFeatureEnableLabel", {
              feature: label,
            })}
          >
            {isEnabled ? t("tenantFeatureDisable") : t("tenantFeatureEnable")}
          </Button>
        </fetcher.Form>
      </div>
      {fetcher.data && !fetcher.data.ok && (
        <p className="text-destructive mt-2 pl-6 text-xs" role="alert">
          {t("tenantFeatureError")}
        </p>
      )}
    </li>
  );
}
