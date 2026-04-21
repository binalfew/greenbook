import { Blocks, Check, Plug, ToggleLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, useFetcher } from "react-router";
import { AuthenticityTokenInput } from "remix-utils/csrf/react";
import { z } from "zod/v4";
import { getFormProps, SwitchField, useForm } from "~/components/form";
import { Badge } from "~/components/ui/badge";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { validateCSRF } from "~/utils/auth/csrf.server";
import { clearFlagCache } from "~/utils/config/feature-flags.server";
import { prisma } from "~/utils/db/db.server";
import type { Route } from "./+types/features";

export const handle = { breadcrumb: "Features" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Feature flags" }];
}

const toggleFlagSchema = z.object({
  flagId: z.string().min(1),
  enabled: z
    .union([z.boolean(), z.string().transform((v) => v === "on" || v === "true")])
    .default(false),
});

const FLAG_LABELS: Record<string, string> = {
  FF_I18N: "Multi-language (i18n)",
  FF_PWA: "Progressive web app",
  FF_WEBHOOKS: "Webhooks",
  FF_TWO_FACTOR: "Two-factor auth",
  FF_IMPERSONATION: "Impersonation",
  FF_NOTIFICATIONS: "Notifications",
  FF_NOTES: "Notes",
  FF_AUDIT_EXPORT: "Audit export",
};

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, "feature-flag", "read");
  const tenantId = user.tenantId;
  const isSuperAdmin = user.roles.some((r) => r.scope === "GLOBAL" && r.name === "admin");

  const [flags, tenantCount] = await Promise.all([
    prisma.featureFlag.findMany({ orderBy: { key: "asc" } }),
    prisma.tenant.count(),
  ]);

  const resolvedFlags = flags.map((f) => {
    const globallyEnabled = f.scope === "global" ? f.enabled : null;

    if (isSuperAdmin) {
      return { ...f, enabled: f.enabled, globallyEnabled };
    }
    if (f.scope === "global") {
      return {
        ...f,
        enabled: f.enabled && !(tenantId && f.disabledForTenants.includes(tenantId)),
        globallyEnabled,
      };
    }
    return {
      ...f,
      enabled: !!tenantId && f.enabledForTenants.includes(tenantId),
      globallyEnabled,
    };
  });

  const enabledCount = resolvedFlags.filter((f) => f.enabled).length;

  return data({
    flags: resolvedFlags,
    enabledCount,
    totalCount: resolvedFlags.length,
    tenantCount,
    canEdit: isSuperAdmin,
    tenantId,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requirePermission(request, "feature-flag", "write");
  const tenantId = user.tenantId;
  const isSuperAdmin = user.roles.some((r) => r.scope === "GLOBAL" && r.name === "admin");

  const formData = await request.formData();
  await validateCSRF(formData, request.headers);

  const flagId = formData.get("flagId");
  const enabledRaw = formData.get("enabled");
  const enabled = enabledRaw === "on" || enabledRaw === "true";

  if (typeof flagId !== "string" || !flagId) {
    return data({ error: "Missing flagId" }, { status: 400 });
  }

  const flag = await prisma.featureFlag.findUnique({ where: { id: flagId } });
  if (!flag) return data({ error: "Flag not found" }, { status: 404 });

  if (isSuperAdmin) {
    await prisma.featureFlag.update({
      where: { id: flagId },
      data: { enabled },
    });
  } else if (flag.scope === "global" && flag.enabled && tenantId) {
    const isCurrentlyOptedOut = flag.disabledForTenants.includes(tenantId);
    if (enabled && isCurrentlyOptedOut) {
      await prisma.featureFlag.update({
        where: { id: flagId },
        data: { disabledForTenants: flag.disabledForTenants.filter((id) => id !== tenantId) },
      });
    } else if (!enabled && !isCurrentlyOptedOut) {
      await prisma.featureFlag.update({
        where: { id: flagId },
        data: { disabledForTenants: [...flag.disabledForTenants, tenantId] },
      });
    }
  }

  clearFlagCache();
  return data({ ok: true });
}

type Flag = Route.ComponentProps["loaderData"]["flags"][number];

export default function FeatureFlagsPage({ loaderData }: Route.ComponentProps) {
  const { flags, enabledCount, totalCount, tenantCount, canEdit } = loaderData;
  const { t } = useTranslation("settings");

  const platformFlags = flags.filter((f) => f.scope === "global");
  const moduleFlags = flags.filter((f) => f.scope === "tenant");

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="bg-primary/10 flex size-12 items-center justify-center rounded-xl">
          <ToggleLeft className="text-primary size-6" />
        </div>
        <div>
          <h2 className="text-foreground text-2xl font-bold">{t("featuresTitle")}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {canEdit ? t("featuresSubtitleAdmin") : t("featuresSubtitleTenant")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("kpiEnabled")}</div>
          <p className="mt-1 text-lg font-bold text-green-600">{enabledCount}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("kpiDisabled")}</div>
          <p className="text-muted-foreground mt-1 text-lg font-bold">
            {totalCount - enabledCount}
          </p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("kpiTotal")}</div>
          <p className="mt-1 text-lg font-bold">{totalCount}</p>
        </div>
        <div className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("kpiTenants")}</div>
          <p className="mt-1 text-lg font-bold">{tenantCount}</p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Plug className="text-muted-foreground size-4" />
          <h3 className="text-sm font-semibold">{t("platformFeatures")}</h3>
          <Badge variant="secondary" className="text-[10px]">
            {platformFlags.filter((f) => f.enabled).length}/{platformFlags.length}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {platformFlags.map((flag) => (
            <FlagCard key={flag.id} flag={flag} canEdit={canEdit} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Blocks className="text-muted-foreground size-4" />
          <h3 className="text-sm font-semibold">{t("moduleFeatures")}</h3>
          <Badge variant="secondary" className="text-[10px]">
            {moduleFlags.filter((f) => f.enabled).length}/{moduleFlags.length}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {moduleFlags.map((flag) => (
            <FlagCard key={flag.id} flag={flag} canEdit={canEdit} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FlagCard({ flag, canEdit }: { flag: Flag; canEdit: boolean }) {
  const fetcher = useFetcher<typeof action>({ key: `flag-${flag.id}` });
  const { t } = useTranslation("settings");
  const isEnabled = fetcher.formData ? fetcher.formData.get("enabled") === "on" : flag.enabled;
  const tenantOverrides = flag.enabledForTenants.length;
  const canToggle = canEdit || (flag.scope === "global" && flag.globallyEnabled);

  const { form, fields } = useForm(toggleFlagSchema, {
    key: `flag-${flag.id}-${flag.enabled}`,
    defaultValue: { flagId: flag.id, enabled: flag.enabled },
  });

  return (
    <div
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
            <p className="text-sm font-medium">{FLAG_LABELS[flag.key] ?? flag.key}</p>
          </div>
          <p className="text-muted-foreground mt-1 pl-6 text-xs">
            {flag.description || t("noDescription")}
          </p>
          <div className="mt-2 flex items-center gap-2 pl-6">
            <Badge variant={isEnabled ? "default" : "secondary"} className="text-[10px]">
              {isEnabled ? t("stateEnabled") : t("stateDisabled")}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {flag.scope === "global" ? t("scopeAllTenants") : t("scopePerTenant")}
            </Badge>
            {flag.scope === "tenant" && tenantOverrides > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {tenantOverrides} {tenantOverrides === 1 ? t("tenantSingular") : t("tenantPlural")}
              </Badge>
            )}
          </div>
        </div>
        {canToggle ? (
          <fetcher.Form
            method="post"
            {...getFormProps(form)}
            onChange={(e) => {
              e.currentTarget.requestSubmit();
            }}
          >
            <AuthenticityTokenInput />
            <input type="hidden" name="flagId" value={flag.id} />
            <SwitchField meta={fields.enabled} />
          </fetcher.Form>
        ) : (
          <Badge variant={isEnabled ? "default" : "outline"} className="shrink-0 text-[10px]">
            {isEnabled ? t("stateOn") : t("stateOff")}
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground mt-2 pl-6 font-mono text-[10px]">{flag.key}</p>
    </div>
  );
}
