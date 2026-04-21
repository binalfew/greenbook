import { Fragment, useMemo, useState } from "react";
import { Form, Link, NavLink, useLocation, useMatches, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Home, LogOut, Search, User } from "lucide-react";
import { ShortcutHelp } from "~/components/layout/shortcut-help";
import {
  useKeyboardShortcuts,
  getShortcutInfo,
  type ShortcutDefinition,
} from "~/utils/use-keyboard-shortcuts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { TenantSwitcher } from "~/components/layout/tenant-switcher";
import { Avatar, AvatarImage, AvatarFallback } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { NotificationBell } from "~/components/notification-bell";
import { LanguageSwitcher } from "~/components/language-switcher";
import {
  CommandPalette,
  buildTemplateCommandPaletteActions,
} from "~/components/layout/command-palette";
import { ThemeSwitch } from "~/routes/resources/theme-switch";
import { cn } from "~/utils/misc";
import type { NavChild, Permission } from "~/config/navigation";
import type { Theme } from "~/utils/theme.server";
import type { SupportedLanguage } from "~/utils/i18n";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string | Date;
}

type TopNavbarProps = {
  user: { id: string; name: string | null; email: string; photoUrl?: string | null };
  tenantSlug?: string;
  basePrefix?: string;
  theme?: Theme | null;
  notificationsEnabled?: boolean;
  unreadCount?: number;
  notifications?: NotificationItem[];
  i18nEnabled?: boolean;
  supportedLangs?: string[];
  currentLanguage?: string;
  settingsChildren?: NavChild[];
  permissions?: Permission[];
  enabledFeatures?: Record<string, boolean>;
  /** In navbar-only layout mode there is no sidebar to toggle. */
  hideSidebarTrigger?: boolean;
  /**
   * Tenant switcher rendered at the far left in navbar-only mode (replaces
   * the sidebar header's tenant branding + dropdown). Omit to render no
   * brand. Reuses the navbar's own `basePrefix` + `permissions` props;
   * `isSuperAdmin` is the only extra bit needed for global-admin gating.
   */
  brandTenant?: {
    name: string;
    slug: string;
    plan: string;
    logoUrl?: string | null;
  } | null;
  brandIsSuperAdmin?: boolean;
};

type BreadcrumbEntry = {
  label: string;
  to?: string;
};

function useBreadcrumbs(): BreadcrumbEntry[] {
  const matches = useMatches();

  const crumbs: BreadcrumbEntry[] = [];
  for (const match of matches) {
    const handle = match.handle as { breadcrumb?: string } | undefined;
    if (handle?.breadcrumb) {
      crumbs.push({
        label: handle.breadcrumb,
        to: match.pathname,
      });
    }
  }

  // Merge section + child into a single "Section | Child" breadcrumb
  const mergeLabels = ["Settings", "Security", "Data"];
  for (let i = 0; i < crumbs.length - 1; i++) {
    if (mergeLabels.includes(crumbs[i].label)) {
      crumbs[i] = {
        label: `${crumbs[i].label} | ${crumbs[i + 1].label}`,
        to: crumbs[i + 1].to,
      };
      crumbs.splice(i + 1, 1);
      break;
    }
  }

  return crumbs;
}

function getUserInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0].toUpperCase();
}

export function TopNavbar({
  user,
  tenantSlug,
  basePrefix = "/admin",
  theme,
  notificationsEnabled = false,
  unreadCount = 0,
  notifications = [],
  i18nEnabled = false,
  supportedLangs,
  currentLanguage,
  settingsChildren = [],
  permissions = [],
  enabledFeatures,
  hideSidebarTrigger = false,
  brandTenant,
  brandIsSuperAdmin = false,
}: TopNavbarProps) {
  const breadcrumbs = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("common");
  const { t: tNav } = useTranslation("nav");
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  const shortcuts = useMemo<ShortcutDefinition[]>(() => {
    const defs: ShortcutDefinition[] = [];

    defs.push({
      id: "search",
      keys: "⌘ K",
      description: "Open command palette",
      group: "global",
      key: "k",
      mod: true,
      handler: () => setSearchOpen((o) => !o),
    });

    defs.push({
      id: "help",
      keys: "?",
      description: "Show keyboard shortcuts",
      group: "global",
      key: "?",
      handler: () => setShortcutHelpOpen((o) => !o),
    });

    defs.push(
      {
        id: "nav-dashboard",
        keys: "g then d",
        description: "Go to Dashboard",
        group: "navigation",
        key: ["g", "d"],
        handler: () => navigate(basePrefix),
      },
      {
        id: "nav-settings",
        keys: "g then s",
        description: "Go to Settings",
        group: "navigation",
        key: ["g", "s"],
        handler: () => navigate(`${basePrefix}/settings`),
      },
    );

    return defs;
  }, [navigate, basePrefix]);

  const commandPaletteActions = useMemo(
    () => buildTemplateCommandPaletteActions(basePrefix, permissions, enabledFeatures),
    [basePrefix, permissions, enabledFeatures],
  );

  useKeyboardShortcuts(shortcuts, {
    enabled: true,
  });

  const shortcutInfoList = useMemo(() => getShortcutInfo(shortcuts), [shortcuts]);

  const subNavChildren = useMemo(() => {
    if (settingsChildren.length > 0 && location.pathname.startsWith(`${basePrefix}/settings`)) {
      return settingsChildren;
    }
    return [];
  }, [settingsChildren, location.pathname, basePrefix]);

  return (
    <>
      <header className="bg-primary text-primary-foreground flex h-12 shrink-0 items-center gap-2 border-b">
        <div
          className={`flex flex-1 items-center gap-2 self-stretch pr-4 ${
            hideSidebarTrigger ? "" : "pl-4"
          }`}
        >
          {!hideSidebarTrigger && (
            <>
              <SidebarTrigger className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground -ml-1" />
              <Separator
                orientation="vertical"
                className="bg-primary-foreground/30 mr-2 data-[orientation=vertical]:h-4"
              />
            </>
          )}
          {brandTenant && (
            <>
              <TenantSwitcher
                variant="navbar"
                tenant={brandTenant}
                basePrefix={basePrefix}
                isSuperAdmin={brandIsSuperAdmin}
                permissions={permissions}
              />
              <Separator
                orientation="vertical"
                className="bg-primary-foreground/30 mr-2 data-[orientation=vertical]:h-4"
              />
            </>
          )}
          {hideSidebarTrigger && (
            <>
              <NavLink
                to={basePrefix}
                end
                className={({ isActive }) =>
                  cn(
                    "hover:bg-primary-foreground/10 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive ? "bg-primary-foreground/10" : "text-primary-foreground/80",
                  )
                }
              >
                <Home className="size-4" />
                <span>{tNav("dashboard")}</span>
              </NavLink>
              <Separator
                orientation="vertical"
                className="bg-primary-foreground/30 mr-2 data-[orientation=vertical]:h-4"
              />
            </>
          )}
          <Breadcrumb className="hidden md:flex">
            <BreadcrumbList className="text-primary-foreground/70">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <Fragment key={crumb.to ?? crumb.label}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage className="text-primary-foreground">
                          {crumb.label}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild className="hover:text-primary-foreground">
                          <Link to={crumb.to!}>{crumb.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="[&_button]:text-primary-foreground [&_button:hover]:bg-primary-foreground/10 [&_button:hover]:text-primary-foreground flex items-center gap-1 px-2 sm:gap-2 sm:px-4">
          {/* Command palette trigger — mobile icon button + desktop pill. */}
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground size-8 md:hidden"
            onClick={() => setSearchOpen(true)}
            aria-label={t("search")}
          >
            <Search className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t("search")}
            className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/70 hover:bg-primary-foreground/20 hidden cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors md:flex"
          >
            <Search className="size-4" />
            <span>{t("search")}</span>
            <kbd className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/70 pointer-events-none ml-2 inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium select-none">
              <span className="text-xs">&#8984;</span>K
            </kbd>
          </button>

          {i18nEnabled && currentLanguage && (
            <div className="hidden sm:flex">
              <LanguageSwitcher
                currentLanguage={currentLanguage as SupportedLanguage}
                allowed={supportedLangs}
                className="[&_select]:border-primary-foreground/30 [&_select]:bg-primary-foreground/10 [&_select]:text-primary-foreground"
              />
            </div>
          )}

          <ThemeSwitch userPreference={theme} />

          {/* Notifications */}
          {notificationsEnabled && tenantSlug && (
            <NotificationBell
              tenantSlug={tenantSlug}
              unreadCount={unreadCount}
              recent={notifications.map((n) => ({
                id: n.id,
                title: n.title,
                message: n.message,
                type: n.type,
                read: n.read,
                createdAt: n.createdAt,
              }))}
            />
          )}

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-primary-foreground/10 size-8 rounded-full"
              >
                <Avatar className="border-primary-foreground/30 size-8 border">
                  {user.photoUrl && (
                    <AvatarImage src={user.photoUrl} alt={user.name ?? user.email} />
                  )}
                  <AvatarFallback className="bg-primary-foreground/10 text-primary-foreground text-xs">
                    {getUserInitials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm leading-none font-medium">{user.name ?? user.email}</p>
                  <p className="text-muted-foreground text-xs leading-none">{user.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={`${basePrefix}/profile`}>
                  <User />
                  {t("profile")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <Form method="post" action="/logout">
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full">
                    <LogOut />
                    {t("signOut")}
                  </button>
                </DropdownMenuItem>
              </Form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ShortcutHelp
          open={shortcutHelpOpen}
          onOpenChange={setShortcutHelpOpen}
          shortcuts={shortcutInfoList}
        />

        <CommandPalette
          open={searchOpen}
          onOpenChange={setSearchOpen}
          basePrefix={basePrefix}
          quickActions={commandPaletteActions}
        />
      </header>

      {subNavChildren.length > 0 && (
        <nav className="bg-background flex shrink-0 overflow-x-auto border-b">
          <div className="flex items-center px-4">
            {subNavChildren.map((child) => (
              <NavLink
                key={child.url}
                to={child.url}
                end={child.end}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? "border-primary text-primary border-b-2"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {child.tKey ? tNav(child.tKey) : child.title}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
