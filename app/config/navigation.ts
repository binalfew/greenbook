import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, FileText, ClipboardList, Bell } from "lucide-react";

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
 * The template ships generic app shell surfaces — Dashboard, Notes, Logs,
 * Notifications — plus a Settings entry whose children render in the top-navbar
 * sub-nav when the user is under `/settings/*`. Fork the template and extend
 * this file with your domain modules (the facilities app replaces this entire
 * file with its FMS module list).
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
        {
          title: "Notes",
          tKey: "notes",
          description: "Team-shared notes with categories and comments.",
          url: `${basePrefix}/notes`,
          icon: FileText,
          featureFlag: "FF_NOTES",
        },
        {
          title: "Logs",
          tKey: "logs",
          description: "Full audit trail of every change in this tenant.",
          url: `${basePrefix}/logs`,
          icon: ClipboardList,
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
  ];
}

export function buildSettingsChildren(basePrefix: string): NavChild[] {
  return [
    {
      title: "General",
      tKey: "general",
      url: `${basePrefix}/settings`,
      end: true,
    },
    {
      title: "Organization",
      tKey: "organization",
      url: `${basePrefix}/settings/organization`,
    },
    {
      title: "Features",
      tKey: "featureFlags",
      url: `${basePrefix}/settings/features`,
    },
    {
      title: "Webhooks",
      tKey: "webhooks",
      url: `${basePrefix}/settings/webhooks`,
      featureFlag: "FF_WEBHOOKS",
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
): NavGroup[] {
  return buildNavigationGroups(basePrefix)
    .map((group) => ({
      ...group,
      items: group.items
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
