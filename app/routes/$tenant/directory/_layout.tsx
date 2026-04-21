import { Building2, Gauge, Inbox, Network, ScrollText, Users } from "lucide-react";
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

  const tabs: NavTabItem[] = [
    { to: base, label: t("tabs.home"), icon: Gauge, end: true },
    { to: `${base}/organizations`, label: t("tabs.organizations"), icon: Network },
    { to: `${base}/people`, label: t("tabs.people"), icon: Users },
    { to: `${base}/positions`, label: t("tabs.positions"), icon: Building2 },
    ...(canReview
      ? [{ to: `${base}/changes`, label: t("tabs.changes"), icon: ScrollText }]
      : canSubmit
        ? [{ to: `${base}/changes/mine`, label: t("tabs.mySubmissions"), icon: Inbox }]
        : []),
  ];

  return (
    <div className="space-y-4">
      <NavTabs items={tabs} />
      <Outlet />
    </div>
  );
}
