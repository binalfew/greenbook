import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Network,
  Settings,
  Users,
} from "lucide-react";

export type Permission = { resource: string; action: string };

export type NavChild = {
  title: string;
  tKey?: string;
  url: string;
  end?: boolean;
  permission?: string;
  featureFlag?: string;
  /** Short one-line description rendered on module-grid cards. */
  description?: string;
};

export type NavItem = {
  title: string;
  tKey?: string;
  url: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: string;
  featureFlag?: string;
  /** Shown only to the global admin, whatever permissions a role carries. */
  globalAdminOnly?: boolean;
  children?: NavChild[];
  /** Short one-line description rendered on module-grid cards. */
  description?: string;
};

export type NavGroup = {
  label: string;
  tKey?: string;
  items: NavItem[];
};

export function hasPermission(permissions: Permission[], required: string): boolean {
  const [resource, action] = required.split(":");
  return permissions.some((p) => p.resource === resource && p.action === action);
}

function isVisibleEntry(
  entry: { permission?: string; featureFlag?: string },
  permissions: Permission[],
  enabledFeatures?: Record<string, boolean>,
): boolean {
  return (
    (!entry.permission || hasPermission(permissions, entry.permission)) &&
    (!entry.featureFlag || !!enabledFeatures?.[entry.featureFlag])
  );
}

/**
 * Template sidebar navigation.
 *
 * Sidebar navigation: the workspace pages under "Main", then the admin
 * pages (Tenants, Settings) under "Administration". The same list drives
 * the module cards on the tenant dashboard.
 */
export function buildNavigationGroups(basePrefix: string): NavGroup[] {
  return [
    {
      label: "Main",
      tKey: "main",
      items: [
        {
          title: "Dashboard",
          tKey: "dashboard",
          description: "Your workspace overview.",
          url: basePrefix,
          icon: LayoutDashboard,
          end: true,
        },
        // The directory's sections sit at the top level, matching their URLs
        // (`/<tenant>/people`, not `/<tenant>/directory/people`). Each is
        // hidden where the tenant has no directory or the user cannot read it.
        {
          title: "Organogram",
          tKey: "orgs",
          description: "Organs, departments, offices and units, and how they fit together.",
          url: `${basePrefix}/organogram`,
          icon: Network,
          featureFlag: "FF_DIRECTORY",
          permission: "organization:read",
        },
        {
          title: "People",
          tKey: "people",
          description: "The people listed in the directory.",
          url: `${basePrefix}/people`,
          icon: Users,
          featureFlag: "FF_DIRECTORY",
          permission: "person:read",
        },
        {
          title: "Positions",
          tKey: "positions",
          description: "Formal posts and who holds them.",
          url: `${basePrefix}/positions`,
          icon: BriefcaseBusiness,
          featureFlag: "FF_DIRECTORY",
          permission: "position:read",
        },
        {
          title: "Approvals",
          tKey: "approvals",
          description: "Changes waiting for review.",
          url: `${basePrefix}/approvals`,
          icon: ListChecks,
          featureFlag: "FF_DIRECTORY",
          permission: "directory-change:read-all",
        },
        {
          title: "Submissions",
          tKey: "mySubs",
          description: "Your drafts and the changes you sent for review.",
          url: `${basePrefix}/submissions`,
          icon: Inbox,
          featureFlag: "FF_DIRECTORY",
          permission: "directory-change:submit",
        },
        {
          title: "History",
          tKey: "history",
          description: "Changes that were approved, rejected or withdrawn.",
          url: `${basePrefix}/approvals/history`,
          icon: History,
          featureFlag: "FF_DIRECTORY",
          permission: "directory-change:read-all",
        },
        {
          title: "Logs",
          tKey: "logs",
          description: "Full audit trail of every change in this tenant.",
          url: `${basePrefix}/logs`,
          icon: ClipboardList,
          // Audit log is global-admin-only per platform policy. The route
          // also requires the perm at the loader; this keeps the link from
          // rendering for users who would 403 on click.
          permission: "audit-log:read",
        },
        {
          title: "Notifications",
          tKey: "notifications",
          description: "Inbox for in-app alerts and mentions.",
          url: `${basePrefix}/notifications`,
          icon: Bell,
          featureFlag: "FF_NOTIFICATIONS",
        },
      ],
    },
    {
      label: "Administration",
      tKey: "administration",
      items: [
        {
          title: "Tenants",
          tKey: "tenants",
          description: "The organizations that keep their own part of the directory.",
          url: `${basePrefix}/tenants`,
          icon: Building2,
          globalAdminOnly: true,
        },
        {
          // Its tabs (General, Organization, Features, Security, References)
          // render in the top bar once the user is under /settings.
          title: "Settings",
          tKey: "settings",
          description: "Settings, features, users and roles, and reference data.",
          url: `${basePrefix}/settings`,
          icon: Settings,
          permission: "settings:read",
        },
      ],
    },
  ];
}

export function buildSettingsChildren(basePrefix: string): NavChild[] {
  return [
    {
      // Most settings tabs are global-admin-only per platform policy. Each
      // is gated on the perm its loader requires; tenant admins land on
      // /settings/security/users (their only allowed surface) and only see
      // the Security tab in the side-nav.
      title: "General",
      tKey: "general",
      url: `${basePrefix}/settings`,
      end: true,
      permission: "settings:read",
    },
    {
      title: "Features",
      tKey: "featureFlags",
      url: `${basePrefix}/settings/features`,
      permission: "feature-flag:read",
    },
    {
      title: "Security",
      tKey: "security",
      url: `${basePrefix}/settings/security`,
      permission: "user:read",
    },
    {
      title: "References",
      tKey: "references",
      url: `${basePrefix}/settings/references`,
      permission: "reference-data:read",
    },
  ];
}

export function getVisibleSettingsChildren(
  permissions: Permission[],
  basePrefix = "/admin",
  enabledFeatures?: Record<string, boolean>,
): NavChild[] {
  return buildSettingsChildren(basePrefix).filter((child) =>
    isVisibleEntry(child, permissions, enabledFeatures),
  );
}

export function getVisibleGroups(
  permissions: Permission[],
  basePrefix = "/admin",
  enabledFeatures?: Record<string, boolean>,
  isGlobalAdmin = false,
): NavGroup[] {
  return buildNavigationGroups(basePrefix)
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !item.globalAdminOnly || isGlobalAdmin)
        .filter((item) => isVisibleEntry(item, permissions, enabledFeatures))
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) =>
            isVisibleEntry(child, permissions, enabledFeatures),
          ),
        })),
    }))
    .filter((group) => group.items.length > 0);
}
