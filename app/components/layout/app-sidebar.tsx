import * as React from "react";
import { NavMain } from "~/components/layout/nav-main";
import { TenantSwitcher } from "~/components/layout/tenant-switcher";
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from "~/components/ui/sidebar";
import { getVisibleGroups, type Permission } from "~/config/navigation";

type TenantInfo = {
  name: string;
  slug: string;
  plan: string;
  logoUrl?: string | null;
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  permissions: Permission[];
  isSuperAdmin: boolean;
  groupState: Record<string, boolean>;
  basePrefix?: string;
  tenant?: TenantInfo | null;
  enabledFeatures?: Record<string, boolean>;
};

export function AppSidebar({
  permissions,
  isSuperAdmin,
  groupState,
  basePrefix = "/admin",
  tenant,
  enabledFeatures,
  ...props
}: AppSidebarProps) {
  const groups = getVisibleGroups(permissions, basePrefix, enabledFeatures);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="bg-primary text-primary-foreground h-12 justify-center p-0">
        <TenantSwitcher
          tenant={tenant}
          basePrefix={basePrefix}
          isSuperAdmin={isSuperAdmin}
          permissions={permissions}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} groupState={groupState} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
