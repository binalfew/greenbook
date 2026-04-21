import { CheckCircle, Info, Pencil, Shield, Trash2, Users, Wifi, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data, useFetcher } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  getSSOConfigById,
  getSSOConnectionCountByConfig,
  testSSOConfiguration,
} from "~/services/sso.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { IDP_INSTRUCTIONS } from "~/utils/constants/sso";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Detail" };

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
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const callbackUrl = `${appUrl}/sso/callback`;

  // Strip the clientSecret before sending to browser
  const { clientSecret: _, ...safeConfig } = config;
  return data({
    config: { ...safeConfig, hasSecret: !!config.clientSecret },
    connectionCount,
    callbackUrl,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "sso", "read");
  if (!user.tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "test") {
    const result = await testSSOConfiguration(params.ssoConfigId);
    return data({ testResult: result });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export default function SSOConfigDetailPage({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("sso");
  const { t: tc } = useTranslation("common");
  const { config, connectionCount, callbackUrl } = loaderData;
  const base = `/${params.tenant}/settings/security/sso`;
  const testFetcher = useFetcher<typeof action>();

  const testResult =
    testFetcher.data && "testResult" in testFetcher.data ? testFetcher.data.testResult : null;

  const instructions = IDP_INSTRUCTIONS[config.provider] ?? IDP_INSTRUCTIONS.CUSTOM_OIDC;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex size-12 items-center justify-center rounded-xl">
            <Shield className="text-primary size-6" />
          </div>
          <div>
            <h2 className="text-foreground text-2xl font-bold">
              {config.displayName || config.provider}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{config.provider}</Badge>
              <Badge variant="secondary">{config.protocol}</Badge>
              {config.isActive ? (
                <Badge variant="default">
                  <CheckCircle className="mr-1 size-3" />
                  {t("active")}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <XCircle className="mr-1 size-3" />
                  {t("inactive")}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link to={base}>{tc("back")}</Link>
          </Button>
          <Button size="sm" asChild className="w-full sm:w-auto">
            <Link to={`${base}/${config.id}/edit`}>
              <Pencil className="mr-1.5 size-3.5" />
              {tc("edit")}
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild className="w-full sm:w-auto">
            <Link to={`${base}/${config.id}/delete`}>
              <Trash2 className="mr-1.5 size-3.5" />
              {tc("delete")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Users className="size-3" />
            {t("linkedUsers")}
          </div>
          <p className="mt-1 text-lg font-bold">{connectionCount}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("autoProvisionShort")}</div>
          <p className="mt-1 text-lg font-bold">{config.autoProvision ? tc("yes") : tc("no")}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("enforceShort")}</div>
          <p className="mt-1 text-lg font-bold">{config.enforceSSO ? tc("yes") : tc("no")}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("protocol")}</div>
          <p className="mt-1 text-lg font-bold">{config.protocol}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("configurationCard")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("issuerUrl")}</span>
              <span className="max-w-[60%] truncate text-right font-mono text-xs">
                {config.issuerUrl || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("clientId")}</span>
              <span className="font-mono text-xs">{config.clientId ? "••••••" : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("clientSecret")}</span>
              <span className="font-mono text-xs">{config.hasSecret ? "••••••" : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("callbackUrlLabel")}</span>
              <span className="max-w-[60%] truncate text-right font-mono text-xs">
                {config.callbackUrl}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="size-4" />
              {t("testConnection")}
            </CardTitle>
            <CardDescription>{t("testConnectionHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {testResult && (
              <div
                className={`mb-4 rounded-md p-3 text-sm ${
                  testResult.success
                    ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {testResult.success ? t("testSuccess") : testResult.error || t("testFailed")}
              </div>
            )}
            <testFetcher.Form method="post">
              <Button
                type="submit"
                name="intent"
                value="test"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={testFetcher.state !== "idle"}
              >
                <Wifi className="mr-2 size-4" />
                {testFetcher.state !== "idle" ? t("testing") : t("runTest")}
              </Button>
            </testFetcher.Form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-4" />
            {instructions.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-muted-foreground list-inside list-decimal space-y-1.5 text-sm">
            {instructions.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <div className="bg-muted mt-3 rounded-md p-3">
            <p className="text-muted-foreground text-xs font-medium">{t("callbackUrlLabel")}</p>
            <p className="mt-1 font-mono text-sm select-all">{callbackUrl}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
