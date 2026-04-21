import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { OrganizationEditor } from "./+shared/organization-editor";
import type { Route } from "./+types/new";

export { action } from "./+shared/organization-editor.server";

export const handle = { breadcrumb: "New" };

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId, canDirect } = await requireDirectoryWriteAccess(request, "organization");

  const [types, parents] = await Promise.all([
    prisma.organizationType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, level: true },
    }),
    prisma.organization.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, acronym: true },
    }),
  ]);

  return data({ types, parents, canDirect });
}

export default function NewOrganization({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/organizations`;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("organizations.new")}</h1>
        <p className="text-muted-foreground text-sm">{t("organizations.newSubtitle")}</p>
      </header>
      <OrganizationEditor
        types={loaderData.types}
        parents={loaderData.parents}
        canDirectApply={loaderData.canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
