import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { RejectionNotes } from "~/components/directory/rejection-notes";
import { getOrganization } from "~/services/organizations.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { loadEditorDraft } from "~/utils/directory-submit.server";
import { OrganizationEditor } from "../+shared/organization-editor";
import type { Route } from "./+types/edit";

export { action } from "../+shared/organization-editor.server";

export const handle = { breadcrumb: "Edit" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const access = await requireDirectoryWriteAccess(request, "organization");
  const { tenantId, canDirect } = access;
  const draft = await loadEditorDraft(request, access, "ORGANIZATION", params.orgId);

  const [org, types, parents] = await Promise.all([
    getOrganization(params.orgId, tenantId),
    prisma.organizationType.findMany({
      where: { deletedAt: null },
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

  return data({ org, types, parents, canDirect, draft });
}

export default function EditOrganization({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/organogram`;
  const { org, types, parents, canDirect, draft } = loaderData;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("organizations.edit")}</h1>
        <p className="text-muted-foreground text-sm">{t("organizations.editSubtitle")}</p>
      </header>
      <RejectionNotes rejection={loaderData.draft?.rejection} tenant={params.tenant} />
      <OrganizationEditor
        org={org}
        draftValues={draft?.values}
        types={types}
        parents={parents}
        canDirectApply={canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
