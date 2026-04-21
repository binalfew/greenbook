import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  deleteSSOConfiguration,
  getSSOConfigById,
  getSSOConnectionCountByConfig,
} from "~/services/sso.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "sso", "read");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const config = await getSSOConfigById(params.ssoConfigId);
  if (!config || config.tenantId !== tenantId) {
    throw data({ error: "SSO configuration not found" }, { status: 404 });
  }

  const connectionCount = await getSSOConnectionCountByConfig(config.provider, config.tenantId);
  return data({ config, connectionCount });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "sso", "delete");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  await deleteSSOConfiguration(params.ssoConfigId, ctx);
  return redirect(`/${params.tenant}/settings/security/sso`);
}

export default function DeleteSSOConfigPage({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("sso");
  const { t: tc } = useTranslation("common");
  const { config, connectionCount } = loaderData;
  const base = `/${params.tenant}/settings/security/sso`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-2xl font-bold">{t("deleteProvider")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("deleteProviderSubtitle", { name: config.displayName || config.provider })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("providerDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <span className="text-foreground font-medium">{t("provider")}</span>
              <div className="mt-0.5">
                <Badge variant="secondary">{config.provider}</Badge>
              </div>
            </div>
            <div>
              <span className="text-foreground font-medium">{t("displayName")}</span>
              <p className="text-muted-foreground">{config.displayName || "—"}</p>
            </div>
            <div>
              <span className="text-foreground font-medium">{t("protocol")}</span>
              <div className="mt-0.5">
                <Badge variant="secondary">{config.protocol}</Badge>
              </div>
            </div>
            <div>
              <span className="text-foreground font-medium">{t("status")}</span>
              <div className="mt-0.5">
                <Badge variant={config.isActive ? "default" : "secondary"}>
                  {config.isActive ? t("active") : t("inactive")}
                </Badge>
              </div>
            </div>
          </div>

          {connectionCount > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {t("linkedUsersWarningTitle", { count: connectionCount })}
                </p>
                <p className="mt-0.5">{t("linkedUsersWarningBody")}</p>
              </div>
            </div>
          )}

          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {t("deleteWarning")}
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <Form method="post">
              <Button type="submit" variant="destructive" className="w-full sm:w-auto">
                {tc("delete")}
              </Button>
            </Form>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <Link to={`${base}/${config.id}`}>{tc("cancel")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
