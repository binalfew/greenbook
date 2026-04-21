import { ArrowLeft, KeyRound, Pencil, Send, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, Form, Link, Outlet, useFetcher } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import {
  getDeliveryLog,
  getWebhookSubscriptionWithCounts,
  testWebhookEndpoint,
  WebhookError,
} from "~/services/webhooks.server";
import { requireFeature } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$webhookId._layout";

export const handle = { breadcrumb: "Webhook" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_WEBHOOKS");
  const url = new URL(request.url);
  const secretRevealed = url.searchParams.get("secretRevealed") === "1";

  try {
    const subscription = await getWebhookSubscriptionWithCounts(params.webhookId, tenantId);
    const deliveries = await getDeliveryLog(params.webhookId, tenantId, { pageSize: 20 });
    return data({
      subscription,
      deliveries: deliveries.items,
      deliveriesMeta: deliveries.meta,
      secretRevealed,
    });
  } catch (err) {
    if (err instanceof WebhookError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

type TestResult = {
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
};

export async function action({ request, params }: Route.ActionArgs) {
  const { user, tenantId } = await requireFeature(request, "FF_WEBHOOKS");
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "test") {
    const ctx = buildServiceContext(request, user, tenantId);
    const result = await testWebhookEndpoint(params.webhookId, ctx);
    const testResult: TestResult = {
      success: result.success,
      statusCode: result.statusCode ?? null,
      latencyMs: result.latencyMs ?? null,
      error: result.error ?? null,
    };
    return data({ testResult });
  }
  return data({ testResult: null as TestResult | null });
}

export default function WebhookDetailLayout({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { t } = useTranslation("webhooks");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/webhooks`;
  const { subscription, deliveries, secretRevealed } = loaderData;
  const testResult: TestResult | null = actionData?.testResult ?? null;
  const testFetcher = useFetcher();

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

  const deliveryStatusClass = (status: string) =>
    status === "DELIVERED"
      ? "text-green-700 dark:text-green-400"
      : status === "DEAD_LETTER" || status === "FAILED"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-2xl font-semibold">{subscription.url}</h1>
          {subscription.description && (
            <p className="text-muted-foreground text-sm">{subscription.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={base}>
              <ArrowLeft className="size-3.5" />
              {tc("back")}
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`${base}/${subscription.id}/edit`}>
              <Pencil className="size-3.5" />
              {tc("edit")}
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`${base}/${subscription.id}/rotate-secret`}>
              <KeyRound className="size-3.5" />
              {t("rotateSecret")}
            </Link>
          </Button>
          <Button variant="destructive" size="sm" asChild>
            <Link to={`${base}/${subscription.id}/delete`}>
              <Trash2 className="size-3.5" />
              {t("deleteSubscription")}
            </Link>
          </Button>
        </div>
      </header>

      {secretRevealed && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium">{t("created")}</p>
            <code className="bg-background block rounded p-2 font-mono text-xs break-all">
              {subscription.secret}
            </code>
          </CardContent>
        </Card>
      )}

      {testResult && (
        <Card
          className={
            testResult.success
              ? "border-green-300 bg-green-50 dark:bg-green-950/20"
              : "border-destructive bg-destructive/10"
          }
        >
          <CardContent className="pt-6 text-sm">
            {testResult.success
              ? `${t("testPingSent")} (HTTP ${testResult.statusCode}, ${testResult.latencyMs}ms)`
              : t("testPingFailed", { error: testResult.error ?? "unknown" })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">{t("recentDeliveries")}</CardTitle>
            <testFetcher.Form method="post">
              <Button
                type="submit"
                name="intent"
                value="test"
                variant="outline"
                size="sm"
                disabled={testFetcher.state !== "idle"}
              >
                <Send className="size-3.5" />
                {t("testPing")}
              </Button>
            </testFetcher.Form>
          </CardHeader>
          <CardContent className="space-y-2">
            {deliveries.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">{t("noDeliveries")}</p>
            ) : (
              <div className="divide-y">
                {deliveries.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{d.eventType}</p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(d.createdAt).toLocaleString()}
                        {d.attempts > 1 && ` · ${t("attempts")}: ${d.attempts}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className={deliveryStatusClass(d.status)}>{d.status}</p>
                      {d.responseCode && (
                        <p className="text-muted-foreground">
                          HTTP {d.responseCode}
                          {d.latencyMs != null && ` · ${d.latencyMs}ms`}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{tc("status")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <InfoRow label={tc("status")}>{statusBadge(subscription.status)}</InfoRow>
            <InfoRow label={t("events")}>
              <span className="text-xs">{subscription.events.length}</span>
            </InfoRow>
            <InfoRow label={t("secret")}>
              <span className="font-mono text-xs">{t("secretHidden")}</span>
            </InfoRow>
            <InfoRow label={tc("created")}>
              <span className="text-xs">{new Date(subscription.createdAt).toLocaleString()}</span>
            </InfoRow>
            <InfoRow label={tc("updated")}>
              <span className="text-xs">{new Date(subscription.updatedAt).toLocaleString()}</span>
            </InfoRow>
          </CardContent>
        </Card>
      </div>

      <Outlet />
    </div>
  );
}
