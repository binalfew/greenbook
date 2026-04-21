import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { OrganizationHierarchyTree } from "~/components/directory/organization-hierarchy-tree";
import { publicListOrganizationTreeRoots } from "~/services/organizations.server";
import {
  PUBLIC_CACHE_HEADER,
  getPublicContext,
  publicOrgToTreeNode,
} from "~/utils/public-directory.server";
import type { Route } from "./+types/index";

// Public organizations index — read-only tree across all opted-in tenants.
// Every tenant's root appears as a peer top-level node. No tenant label.

export async function loader() {
  const { publicTenantIds, isEmpty } = await getPublicContext();
  const roots = isEmpty ? [] : await publicListOrganizationTreeRoots(publicTenantIds);
  const trees = roots.map(publicOrgToTreeNode);

  return data({ trees, isEmpty }, { headers: { "Cache-Control": PUBLIC_CACHE_HEADER } });
}

export function headers() {
  return { "Cache-Control": PUBLIC_CACHE_HEADER };
}

export default function PublicOrganizationsIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("directory-public");
  const { trees, isEmpty } = loaderData;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("organizationsPage.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("organizationsPage.subtitle")}</p>
      </header>

      {isEmpty ? (
        <div className="bg-muted/20 flex flex-col items-center justify-center rounded-lg border py-12 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <Network className="text-muted-foreground size-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">{t("organizationsPage.empty")}</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {t("organizationsPage.emptyHelp")}
          </p>
        </div>
      ) : (
        <OrganizationHierarchyTree
          roots={trees}
          baseUrl="/public/directory/organizations"
          childrenUrl="/public/directory/api/organizations/children"
          moveUrl=""
          canMove={false}
          searchPlaceholder={t("organizationsPage.searchPlaceholder")}
          emptyMessage={t("organizationsPage.emptyHelp")}
          labels={{
            expandAll: t("organizationsPage.expandAll"),
            collapseAll: t("organizationsPage.collapseAll"),
            placeholder: t("organizationsPage.loadingChildren"),
            resultCount: (count) => t("organizationsPage.resultCount", { count }),
          }}
        />
      )}
    </div>
  );
}
