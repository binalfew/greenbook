import { Outlet, useNavigation } from "react-router";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/layout/app-sidebar";
import { TopNavbar } from "~/components/layout/top-navbar";
import { Toaster } from "~/components/ui/sonner";
import { getVisibleSettingsChildren, type Permission } from "~/config/navigation";
import { InstallPrompt } from "~/components/pwa/install-prompt";
import { SwUpdatePrompt } from "~/components/pwa/sw-update-prompt";
import { OfflineBanner } from "~/components/offline-banner";
import type { LayoutMode } from "~/utils/layout-mode";
import type { Theme } from "~/utils/theme.server";

type TenantInfo = {
  name: string;
  slug: string;
  plan: string;
  logoUrl?: string | null;
};

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string | Date;
};

export type DashboardLayoutProps = {
  basePrefix: string;
  tenant?: TenantInfo | null;
  user: { id: string; name: string | null; email: string; photoUrl?: string | null };
  isGlobalAdmin?: boolean;
  permissions: Permission[];
  sidebarOpen: boolean;
  sidebarGroups: Record<string, boolean>;
  layoutMode?: LayoutMode;
  theme?: Theme | null;
  i18nEnabled: boolean;
  supportedLangs?: string[];
  currentLanguage?: string;
  pwaEnabled: boolean;
  notificationsEnabled: boolean;
  unreadCount: number;
  recentNotifications: NotificationItem[];
  enabledFeatures?: Record<string, boolean>;
};

export function DashboardLayout({
  basePrefix,
  tenant,
  user,
  isGlobalAdmin = false,
  permissions,
  sidebarOpen,
  sidebarGroups,
  layoutMode = "sidebar",
  theme,
  i18nEnabled,
  supportedLangs,
  currentLanguage,
  pwaEnabled,
  notificationsEnabled,
  unreadCount,
  recentNotifications,
  enabledFeatures,
}: DashboardLayoutProps) {
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const settingsChildren = getVisibleSettingsChildren(permissions, basePrefix, enabledFeatures);

  const progressBar = isNavigating && (
    <div className="bg-primary/20 fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="bg-primary h-full w-1/3 animate-[progress_1s_ease-in-out_infinite]" />
    </div>
  );

  const topNavbar = (
    <TopNavbar
      user={user}
      tenantSlug={tenant?.slug}
      basePrefix={basePrefix}
      theme={theme}
      i18nEnabled={i18nEnabled}
      supportedLangs={supportedLangs}
      currentLanguage={currentLanguage}
      notificationsEnabled={notificationsEnabled}
      unreadCount={unreadCount}
      notifications={recentNotifications}
      settingsChildren={settingsChildren}
      permissions={permissions}
      enabledFeatures={enabledFeatures}
      hideSidebarTrigger={layoutMode === "navbar"}
      brandTenant={layoutMode === "navbar" ? (tenant ?? null) : undefined}
      brandIsSuperAdmin={isGlobalAdmin}
    />
  );

  const globalOverlays = (
    <>
      <Toaster />
      <OfflineBanner />
      {pwaEnabled && (
        <>
          <InstallPrompt />
          <SwUpdatePrompt />
        </>
      )}
    </>
  );

  if (layoutMode === "navbar") {
    return (
      <div className="flex min-h-svh flex-col">
        {progressBar}
        {topNavbar}
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
        {globalOverlays}
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        permissions={permissions}
        isSuperAdmin={isGlobalAdmin}
        groupState={sidebarGroups}
        basePrefix={basePrefix}
        tenant={tenant}
        enabledFeatures={enabledFeatures}
      />
      <SidebarInset>
        {progressBar}
        {topNavbar}
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
      {globalOverlays}
    </SidebarProvider>
  );
}
