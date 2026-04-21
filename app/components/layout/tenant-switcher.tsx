import { Building2, ChevronsUpDown, ClipboardList, Settings } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import defaultLogoUrl from "~/assets/logo.svg";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import { type Permission, hasPermission } from "~/config/navigation";

type TenantInfo = {
  name: string;
  slug: string;
  plan: string;
  logoUrl?: string | null;
};

const fallbackTenant: TenantInfo = {
  name: "Platform",
  slug: "admin",
  plan: "enterprise",
};

type TenantSwitcherProps = {
  tenant?: TenantInfo | null;
  basePrefix?: string;
  isSuperAdmin?: boolean;
  permissions?: Permission[];
  /**
   * `"sidebar"` (default) renders the existing collapsible SidebarMenu form
   * for use inside `<AppSidebar>`. `"navbar"` renders a button-shaped
   * dropdown trigger with the same menu items — used as the app-brand slot
   * in navbar-only layout mode. The navbar variant does NOT depend on a
   * surrounding `SidebarProvider`.
   */
  variant?: "sidebar" | "navbar";
};

export function TenantSwitcher(props: TenantSwitcherProps) {
  const variant = props.variant ?? "sidebar";
  if (variant === "navbar") return <NavbarVariant {...props} />;
  return <SidebarVariant {...props} />;
}

function DropdownBody({
  basePrefix,
  isSuperAdmin,
  permissions,
}: {
  basePrefix: string;
  isSuperAdmin: boolean;
  permissions: Permission[];
}) {
  const { t } = useTranslation("nav");
  return (
    <>
      {hasPermission(permissions, "settings:read") && (
        <DropdownMenuItem className="gap-2 p-2" asChild>
          <Link to={`${basePrefix}/settings`}>
            <Settings className="size-4 shrink-0" />
            {t("settings")}
          </Link>
        </DropdownMenuItem>
      )}
      {isSuperAdmin && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 p-2" asChild>
            <Link to={`${basePrefix}/tenants`}>
              <Building2 className="size-4 shrink-0" />
              {t("tenants")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 p-2" asChild>
            <Link to={`${basePrefix}/logs`}>
              <ClipboardList className="size-4 shrink-0" />
              {t("auditLogs")}
            </Link>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function SidebarVariant({
  tenant,
  basePrefix = "/admin",
  isSuperAdmin = false,
  permissions = [],
}: TenantSwitcherProps) {
  const { isMobile, state } = useSidebar();
  const activeTenant = tenant ?? fallbackTenant;
  const collapsed = state === "collapsed";
  const hasDropdownItems = isSuperAdmin || hasPermission(permissions, "settings:read");

  const tenantDisplay = (
    <>
      <div
        className={`text-primary-foreground flex items-center justify-center overflow-hidden rounded-lg ${collapsed ? "size-8" : "aspect-square size-16"}`}
      >
        <img
          src={activeTenant.logoUrl || defaultLogoUrl}
          alt={activeTenant.name}
          className={`${collapsed ? "size-8" : "size-16"} rounded-lg object-contain brightness-0 invert`}
        />
      </div>
      {!collapsed && (
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-semibold">{activeTenant.name}</span>
        </div>
      )}
    </>
  );

  if (!hasDropdownItems) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div
            className={`text-primary-foreground flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 ${collapsed ? "justify-center" : ""}`}
          >
            {tenantDisplay}
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={`text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground data-[state=open]:bg-primary-foreground/10 data-[state=open]:text-primary-foreground ${collapsed ? "mx-auto !w-8 justify-center !gap-0 !p-0" : "!h-20"}`}
            >
              {tenantDisplay}
              {!collapsed && <ChevronsUpDown className="ml-auto" />}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownBody
              basePrefix={basePrefix}
              isSuperAdmin={isSuperAdmin}
              permissions={permissions}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavbarVariant({
  tenant,
  basePrefix = "/admin",
  isSuperAdmin = false,
  permissions = [],
}: TenantSwitcherProps) {
  const activeTenant = tenant ?? fallbackTenant;
  const hasDropdownItems = isSuperAdmin || hasPermission(permissions, "settings:read");

  const brand = (
    <>
      <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        <img
          src={activeTenant.logoUrl || defaultLogoUrl}
          alt={activeTenant.name}
          className="size-16 rounded-lg object-contain brightness-0 invert"
        />
      </span>
      <span className="hidden text-sm leading-none font-medium sm:block">{activeTenant.name}</span>
    </>
  );

  if (!hasDropdownItems) {
    return (
      <Link
        to={basePrefix}
        className="text-primary-foreground hover:bg-primary-foreground/10 flex items-center gap-2 self-stretch px-3 transition-colors"
        aria-label={activeTenant.name}
      >
        {brand}
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/30 data-[state=open]:bg-primary-foreground/10 flex items-center gap-2 self-stretch px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        aria-label={activeTenant.name}
      >
        {brand}
        <ChevronsUpDown className="text-primary-foreground/70 size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="min-w-56 rounded-lg">
        <DropdownBody
          basePrefix={basePrefix}
          isSuperAdmin={isSuperAdmin}
          permissions={permissions}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
