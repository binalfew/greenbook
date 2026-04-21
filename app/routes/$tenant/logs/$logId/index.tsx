import { ArrowLeft, ClipboardList, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/index";

export const handle = { breadcrumb: "Log detail" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "audit-log", "read");
  const tenantId = user.tenantId;

  const log = await prisma.auditLog.findFirst({
    where: { id: params.logId, tenantId: tenantId ?? undefined },
  });

  if (!log) throw data({ error: "Log entry not found" }, { status: 404 });

  return data({
    log: {
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      description: log.description,
      metadata: log.metadata,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      actingAsUserId: log.actingAsUserId,
      createdAt: log.createdAt.toISOString(),
      userId: log.userId,
    },
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
    second: "2-digit",
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

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function AuditLogDetailPage({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("logs");
  const { log } = loaderData;
  const basePrefix = `/${params.tenant}/logs`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="text-muted-foreground size-5 shrink-0" />
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-foreground text-2xl font-bold">{t("details")}</h2>
            <Badge variant={actionBadgeVariant(log.action)}>{log.action}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link to={basePrefix}>
              <ArrowLeft className="mr-1.5 size-3.5" />
              {t("back")}
            </Link>
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">{formatDate(log.createdAt)}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label={t("date")}>{formatDate(log.createdAt)}</InfoRow>
            <InfoRow label={t("action")}>
              <Badge variant={actionBadgeVariant(log.action)}>{log.action}</Badge>
            </InfoRow>
            <InfoRow label={t("entityType")}>{log.entityType}</InfoRow>
            <InfoRow label={t("entityId")}>
              {log.entityId ? (
                <span className="font-mono text-xs">{log.entityId}</span>
              ) : (
                <span className="text-muted-foreground">&mdash;</span>
              )}
            </InfoRow>
            <InfoRow label={t("description")}>
              {log.description ?? <span className="text-muted-foreground">&mdash;</span>}
            </InfoRow>
            <InfoRow label={t("user")}>
              {log.userId ? (
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono text-xs">{log.userId}</span>
                  <ExternalLink className="size-3" />
                </span>
              ) : (
                <span className="text-muted-foreground">{t("system")}</span>
              )}
            </InfoRow>
            {log.actingAsUserId && (
              <InfoRow label={t("impersonating")}>
                <Badge variant="outline" className="text-xs">
                  {t("impersonating")}
                </Badge>
                <span className="ml-1.5 font-mono text-xs">{log.actingAsUserId}</span>
              </InfoRow>
            )}
            <InfoRow label={t("ipAddress")}>
              {log.ipAddress ?? <span className="text-muted-foreground">&mdash;</span>}
            </InfoRow>
            <InfoRow label={t("userAgent")}>
              {log.userAgent ? (
                <span
                  className="inline-block max-w-xs truncate font-mono text-xs"
                  title={log.userAgent}
                >
                  {log.userAgent}
                </span>
              ) : (
                <span className="text-muted-foreground">&mdash;</span>
              )}
            </InfoRow>
          </CardContent>
        </Card>

        {log.metadata != null && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("metadata")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted overflow-x-auto rounded-lg p-4 font-mono text-xs">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
