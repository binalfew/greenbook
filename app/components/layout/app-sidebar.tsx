import * as React from "react";
import { NavMain } from "~/components/layout/nav-main";
import { TenantBrand } from "~/components/layout/tenant-brand";
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from "~/components/ui/sidebar";
import { getVisibleGroups, type Permission } from "~/config/navigation";

type TenantInfo = {
  name: string;
  slug: string;
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
  const groups = getVisibleGroups(permissions, basePrefix, enabledFeatures, isSuperAdmin);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="bg-primary text-primary-foreground h-12 justify-center p-0">
        <TenantBrand tenant={tenant} basePrefix={basePrefix} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} groupState={groupState} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
