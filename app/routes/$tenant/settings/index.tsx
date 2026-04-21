import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, LayoutList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, Link, useLocation } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { getSettingCategories, getSettingDefinition } from "~/utils/config/settings-registry";
import { getAllSettings } from "~/utils/config/settings.server";
import type { LayoutMode } from "~/utils/layout-mode";
import { getLayoutMode } from "~/utils/layout-mode.server";
import { resolveTenant } from "~/utils/tenant.server";
import type { Route } from "./+types/index";

type LayoutOption = {
  value: LayoutMode;
  icon: LucideIcon;
  title: string;
  description: string;
};

const LAYOUT_OPTIONS: LayoutOption[] = [
  {
    value: "sidebar",
    icon: LayoutList,
    title: "Sidebar",
    description: "Collapsible sidebar with module navigation, plus top navbar.",
  },
  {
    value: "navbar",
    icon: LayoutDashboard,
    title: "Navbar only",
    description: "Top navbar only. Navigate via the dashboard's module grid or ⌘K.",
  },
];

export const handle = { breadcrumb: "General" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  const user = await requirePermission(request, "settings", "read");

  const grouped = await getAllSettings({ userId: user.id, tenantId: tenant.id });
  // Order categories by the registry (skips any unknown DB-only categories at the end).
  const knownCategories = getSettingCategories();
  const sortedCategories = [
    ...knownCategories.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !knownCategories.includes(c)),
  ];

  return data({
    tenantSlug: tenant.slug,
    sortedCategories,
    grouped,
    layoutMode: getLayoutMode(request),
  });
}

export default function SettingsIndex({ loaderData }: Route.ComponentProps) {
  const { sortedCategories, grouped, tenantSlug, layoutMode } = loaderData;
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const location = useLocation();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-lg">
              <LayoutDashboard className="text-primary size-4" />
            </div>
            <div>
              <CardTitle className="text-base">Preferences</CardTitle>
              <CardDescription>
                Personal settings stored in your browser. Applies to this device only.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Form method="post" action="/resources/layout-mode" className="space-y-3">
            <input
              type="hidden"
              name="redirectTo"
              value={`${location.pathname}${location.search}`}
            />
            <div>
              <p className="text-sm font-medium">Layout</p>
              <p className="text-muted-foreground text-xs">
                Choose how the app chrome is arranged. Changes apply after saving.
              </p>
            </div>
            <RadioGroup
              name="mode"
              defaultValue={layoutMode}
              className="grid-cols-1 sm:grid-cols-2"
            >
              {LAYOUT_OPTIONS.map((opt) => {
                const active = layoutMode === opt.value;
                const Icon = opt.icon;
                return (
                  <label
                    key={opt.value}
                    htmlFor={`layout-${opt.value}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      active
                        ? "border-primary bg-primary/5 ring-primary/30 ring-1"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <RadioGroupItem value={opt.value} id={`layout-${opt.value}`} className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className="text-muted-foreground size-4" />
                        <span className="text-sm font-medium">{opt.title}</span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">{opt.description}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
            <Button type="submit" size="sm">
              Save preference
            </Button>
          </Form>
        </CardContent>
      </Card>

      {sortedCategories.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="capitalize">
              {t(`category_${category}`, { defaultValue: category })}
            </CardTitle>
            <CardDescription>{describeCategory(category)}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {grouped[category].map((s) => {
              const def = getSettingDefinition(s.key);
              return (
                <div
                  key={s.key}
                  className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{def?.label ?? s.key}</div>
                    <div className="text-muted-foreground text-sm">{def?.description ?? s.key}</div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {t("resolvedFrom")} <span className="font-mono">{s.scope}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start gap-3">
                    <code className="bg-muted max-w-[220px] truncate rounded px-2 py-1 text-xs">
                      {formatValue(s.type, s.value, tCommon)}
                    </code>
                    <Link
                      to={`/${tenantSlug}/settings/${encodeURIComponent(s.key)}/edit`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {tCommon("edit")}
                    </Link>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function describeCategory(category: string): string {
  switch (category) {
    case "general":
      return "Application display and timezone defaults.";
    case "auth":
      return "Session, lockout, and password policy.";
    case "upload":
      return "File upload limits and allowed extensions.";
    case "email":
      return "Outgoing email sender identity.";
    case "audit":
      return "Audit log retention policy.";
    default:
      return "Settings for this category.";
  }
}

function formatValue(type: string, value: string, tCommon: (key: string) => string): string {
  if (type === "boolean") {
    return value === "true" ? tCommon("on") : tCommon("off");
  }
  return value;
}
