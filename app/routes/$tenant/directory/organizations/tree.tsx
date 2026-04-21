import { List, Network, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, data } from "react-router";
import { Button } from "~/components/ui/button";
import { OrganizationHierarchyTree } from "~/components/directory/organization-hierarchy-tree";
import { listRootOrganizations } from "~/services/organizations.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/tree";

export const handle = { breadcrumb: "Tree" };

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId, canDirect, canSubmit } = await requireDirectoryAccess(request, {
    write: "organization",
  });
  const roots = await listRootOrganizations(tenantId);
  return data({
    roots,
    canMove: canDirect,
    canCreate: canDirect || canSubmit,
  });
}

export default function OrganizationsTree({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/organizations`;
  const { roots, canMove, canCreate } = loaderData;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("organizations.tree.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {canMove ? t("organizations.tree.subtitleManager") : t("organizations.tree.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="default">
            <Link to={base}>
              <List />
              {t("organizations.tree.viewList")}
            </Link>
          </Button>
          {canCreate && (
            <Button asChild size="default">
              <Link to={`${base}/new`}>
                <Plus />
                {t("organizations.new")}
              </Link>
            </Button>
          )}
        </div>
      </header>

      <OrganizationHierarchyTree
        roots={roots}
        baseUrl={base}
        childrenUrl={`/${params.tenant}/directory/api/organizations/children`}
        moveUrl={`/${params.tenant}/directory/api/organizations/move`}
        canMove={canMove}
        searchPlaceholder={t("organizations.searchPlaceholder")}
        emptyMessage={t("organizations.emptyDescription")}
      />

      {roots.length === 0 && (
        <div className="bg-muted/20 flex flex-col items-center justify-center rounded-lg border py-12 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <Network className="text-muted-foreground size-6" />
          </div>
          <h3 className="mt-3 text-base font-semibold">{t("organizations.emptyTitle")}</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {t("organizations.emptyDescription")}
          </p>
        </div>
      )}
    </div>
  );
}
