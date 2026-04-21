import { Building2, Gauge, Inbox, ListChecks, Network, ScrollText, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";
import { NavTabs, type NavTabItem } from "~/components/layout/nav-tabs";
import { hasPermission, requireFeature } from "~/utils/auth/require-auth.server";
import type { Route } from "./+types/_layout";

export const handle = { breadcrumb: "Directory" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireFeature(request, "FF_DIRECTORY");
  return {
    canReview: hasPermission(user, "directory-change", "read-all"),
    canSubmit: hasPermission(user, "directory-change", "submit"),
  };
}

export default function DirectoryLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory`;
  const { canReview, canSubmit } = loaderData;

  // Flat tab strip — change-request views (Pending / Mine / History) sit
  // alongside the entity views. Keeps navigation one level deep so focal
  // persons and managers don't need to drill into a nested "Approvals"
  // section to find their queue.
  const tabs: NavTabItem[] = [
    { to: base, label: t("tabs.home"), icon: Gauge, end: true },
    { to: `${base}/organizations`, label: t("tabs.organizations"), icon: Network },
    { to: `${base}/people`, label: t("tabs.people"), icon: Users },
    { to: `${base}/positions`, label: t("tabs.positions"), icon: Building2 },
    ...(canReview
      ? [{ to: `${base}/approvals`, label: t("tabs.approvals"), icon: ListChecks, end: true }]
      : []),
    ...(canSubmit
      ? [{ to: `${base}/approvals/mine`, label: t("tabs.mySubmissions"), icon: Inbox }]
      : []),
    ...(canReview
      ? [{ to: `${base}/approvals/history`, label: t("tabs.history"), icon: ScrollText }]
      : []),
  ];

  // Pull the NavTabs flush with the top of the dashboard content area so the
  // directory page header sits at the same vertical position as /system/settings
  // (which has no sub-nav strip above its title).
  return (
    <div className="-mt-4 space-y-4 md:-mt-6">
      <NavTabs items={tabs} />
      <Outlet />
    </div>
  );
}
