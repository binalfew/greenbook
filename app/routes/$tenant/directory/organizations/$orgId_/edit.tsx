import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getOrganization } from "~/services/organizations.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { OrganizationEditor } from "../+shared/organization-editor";
import type { Route } from "./+types/edit";

export { action } from "../+shared/organization-editor.server";

export const handle = { breadcrumb: "Edit" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId, canDirect } = await requireDirectoryWriteAccess(request, "organization");

  const [org, types, parents] = await Promise.all([
    getOrganization(params.orgId, tenantId),
    prisma.organizationType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, level: true },
    }),
    prisma.organization.findMany({
      where: { tenantId, deletedAt: null, id: { not: params.orgId } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, acronym: true },
    }),
  ]);

  return data({ org, types, parents, canDirect });
}

export default function EditOrganization({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/organizations`;
  const { org, types, parents, canDirect } = loaderData;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("organizations.edit")}</h1>
        <p className="text-muted-foreground text-sm">{t("organizations.editSubtitle")}</p>
      </header>
      <OrganizationEditor
        org={org}
        types={types}
        parents={parents}
        canDirectApply={canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
