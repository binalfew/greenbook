import { Inbox, ListChecks, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";
import { NavTabs, type NavTabItem } from "~/components/layout/nav-tabs";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/_layout";

export const handle = { breadcrumb: "Approvals" };

export async function loader({ request }: Route.LoaderArgs) {
  const { canReview, canSubmit } = await requireDirectoryAccess(request);
  if (!canReview && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { canReview, canSubmit };
}

export default function ChangesLayout({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/changes`;
  const { canReview, canSubmit } = loaderData;

  const tabs: NavTabItem[] = [
    ...(canReview ? [{ to: base, label: t("tabs.changes"), icon: ListChecks, end: true }] : []),
    ...(canSubmit ? [{ to: `${base}/mine`, label: t("tabs.mySubmissions"), icon: Inbox }] : []),
    ...(canReview
      ? [{ to: `${base}/history`, label: t("changes.historyTitle"), icon: ScrollText }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <NavTabs items={tabs} />
      <Outlet />
    </div>
  );
}
