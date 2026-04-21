import { data } from "react-router";
import { DashboardLayout } from "~/components/layout/dashboard-layout";
import { RoleScope } from "~/generated/prisma/client";
import { requireAuth } from "~/utils/auth/require-auth.server";
import { FEATURE_FLAG_KEYS } from "~/utils/config/feature-flag-keys";
import { isFeatureEnabled } from "~/utils/config/feature-flags.server";
import { getSetting } from "~/utils/config/settings.server";
import { supportedLanguages } from "~/utils/i18n";
import { getLangFromRequest } from "~/utils/i18n-cookie.server";
import { getUnreadCount, listNotifications } from "~/services/notifications.server";
import { resolveTenant } from "~/utils/tenant.server";
import { getSidebarState, getSidebarGroupState } from "~/utils/sidebar.server";
import { getLayoutMode } from "~/utils/layout-mode.server";
import { brandCookie, getTheme } from "~/utils/theme.server";
import type { Route } from "./+types/_layout";

export const handle = { breadcrumb: "Home" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const tenant = await resolveTenant(params.tenant);
  const user = await requireAuth(request);

  const isGlobalAdmin = user.roles.some((r) => r.scope === RoleScope.GLOBAL && r.name === "admin");

  // Tenant users can only see their own tenant. Global admins bypass.
  if (!isGlobalAdmin && user.tenantId !== tenant.id) {
    throw data({ error: "You do not have access to this tenant" }, { status: 403 });
  }

  // Evaluate every template-level feature flag for the current context. Global
  // admins evaluate against the `enabled` toggle (no tenant opt-in required).
  const flagContext = isGlobalAdmin
    ? { roles: user.roles.map((r) => r.name), userId: user.id }
    : { tenantId: tenant.id, roles: user.roles.map((r) => r.name), userId: user.id };

  const flagKeys = Object.values(FEATURE_FLAG_KEYS);
  const flagValues = await Promise.all(flagKeys.map((key) => isFeatureEnabled(key, flagContext)));
  const enabledFeatures: Record<string, boolean> = {};
  flagKeys.forEach((key, i) => {
    enabledFeatures[key] = flagValues[i];
  });

  const currentLanguage = getLangFromRequest(request) ?? "en";

  // Notification bell + listener data — gated on FF_NOTIFICATIONS + FF_SSE.
  const notificationsEnabled = await isFeatureEnabled(FEATURE_FLAG_KEYS.NOTIFICATIONS, flagContext);
  let unreadCount = 0;
  let recentNotifications: Array<{
    id: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
    createdAt: Date;
  }> = [];
  if (notificationsEnabled) {
    unreadCount = await getUnreadCount(user.id);
    const listed = await listNotifications(user.id, { page: 1, perPage: 5 });
    recentNotifications = listed.notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt,
    }));
  }

  // Resolve the tenant's supported-languages allowlist. Parse the comma-separated
  // setting and clamp against the template's supportedLanguages so a misconfigured
  // DB value can't offer codes we don't ship translations for.
  const langSetting = await getSetting("i18n.supported_languages", {
    userId: user.id,
    tenantId: tenant.id,
  });
  const configured = (langSetting?.value ?? "en,fr")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const shipped = supportedLanguages.map((l) => l.code);
  const allowedLanguages = configured.filter((c) =>
    shipped.includes(c as (typeof shipped)[number]),
  );

  // Remember this tenant's slug so auth + public pages can pick up the
  // same brand theme. Refreshed on every tenant visit.
  const setBrandCookie = await brandCookie.serialize(tenant.slug);

  return data(
    {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        brandTheme: tenant.brandTheme,
        subscriptionPlan: tenant.subscriptionPlan,
      },
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      roles: user.roles.map((r) => r.name),
      permissions: user.permissions.map((p) => ({ resource: p.resource, action: p.action })),
      isGlobalAdmin,
      enabledFeatures,
      currentLanguage,
      allowedLanguages,
      notifications: {
        enabled: notificationsEnabled,
        unreadCount,
        recent: recentNotifications,
      },
      theme: getTheme(request),
      sidebarOpen: getSidebarState(request),
      sidebarGroups: getSidebarGroupState(request),
      layoutMode: getLayoutMode(request),
    },
    { headers: { "Set-Cookie": setBrandCookie } },
  );
}

export default function TenantLayout({ loaderData }: Route.ComponentProps) {
  const {
    tenant,
    user,
    permissions,
    isGlobalAdmin,
    enabledFeatures,
    currentLanguage,
    allowedLanguages,
    notifications,
    theme,
    sidebarOpen,
    sidebarGroups,
    layoutMode,
  } = loaderData;
  const basePrefix = `/${tenant.slug}`;
  const i18nEnabled = enabledFeatures[FEATURE_FLAG_KEYS.I18N];
  const pwaEnabled = enabledFeatures[FEATURE_FLAG_KEYS.PWA];

  return (
    <DashboardLayout
      basePrefix={basePrefix}
      tenant={{
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.subscriptionPlan ?? "free",
        logoUrl: tenant.logoUrl,
      }}
      user={{
        id: user.id,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
        email: user.email,
        photoUrl: null,
      }}
      isGlobalAdmin={isGlobalAdmin}
      permissions={permissions}
      sidebarOpen={sidebarOpen}
      sidebarGroups={sidebarGroups}
      layoutMode={layoutMode}
      theme={theme}
      i18nEnabled={i18nEnabled}
      supportedLangs={allowedLanguages}
      currentLanguage={currentLanguage}
      pwaEnabled={pwaEnabled}
      notificationsEnabled={notifications.enabled}
      unreadCount={notifications.unreadCount}
      recentNotifications={notifications.recent}
      enabledFeatures={enabledFeatures}
    />
  );
}
