import { Link } from "react-router";
import defaultLogoUrl from "~/assets/logo.svg";
import { SidebarMenu, SidebarMenuItem, useSidebar } from "~/components/ui/sidebar";

type TenantInfo = {
  name: string;
  slug: string;
  logoUrl?: string | null;
};

/** The product name shown beside the emblem, the same in every tenant. */
const APP_NAME = "Greenbook";

type TenantBrandProps = {
  tenant?: TenantInfo | null;
  basePrefix?: string;
  /**
   * `"sidebar"` (default) renders the emblem and the product name at the top of
   * `<AppSidebar>`, shrinking to the emblem when the sidebar is collapsed.
   * `"navbar"` renders the same brand at the left of the top bar in
   * navbar-only layout mode, and does NOT depend on a surrounding
   * `SidebarProvider`. Either way it is a link to the tenant dashboard.
   */
  variant?: "sidebar" | "navbar";
};

export function TenantBrand(props: TenantBrandProps) {
  if (props.variant === "navbar") return <NavbarVariant {...props} />;
  return <SidebarVariant {...props} />;
}

function SidebarVariant({ tenant, basePrefix = "/admin" }: TenantBrandProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Link
          to={basePrefix}
          aria-label={APP_NAME}
          className={`text-primary-foreground hover:bg-primary-foreground/10 flex items-center gap-2 rounded-md px-2 py-2 transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          <div
            className={`flex items-center justify-center overflow-hidden rounded-lg ${collapsed ? "size-8" : "aspect-square size-16"}`}
          >
            <img
              src={tenant?.logoUrl || defaultLogoUrl}
              alt=""
              className={`${collapsed ? "size-8" : "size-16"} rounded-lg object-contain brightness-0 invert`}
            />
          </div>
          {!collapsed && (
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{APP_NAME}</span>
            </div>
          )}
        </Link>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavbarVariant({ tenant, basePrefix = "/admin" }: TenantBrandProps) {
  return (
    <Link
      to={basePrefix}
      className="text-primary-foreground hover:bg-primary-foreground/10 flex items-center gap-2 self-stretch px-3 transition-colors"
      aria-label={APP_NAME}
    >
      <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        <img
          src={tenant?.logoUrl || defaultLogoUrl}
          alt=""
          className="size-16 rounded-lg object-contain brightness-0 invert"
        />
      </span>
      <span className="hidden text-sm leading-none font-medium sm:block">{APP_NAME}</span>
    </Link>
  );
}
