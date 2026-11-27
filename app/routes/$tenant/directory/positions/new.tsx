import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { loadEditorDraft } from "~/utils/directory-submit.server";
import { PositionEditor } from "./+shared/position-editor";
import type { Route } from "./+types/new";

export { action } from "./+shared/position-editor.server";

export const handle = { breadcrumb: "New" };

export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireDirectoryWriteAccess(request, "position");
  const { tenantId, canDirect } = access;
  const draft = await loadEditorDraft(request, access, "POSITION");

  const [organizations, types, reportsToCandidates] = await Promise.all([
    prisma.organization.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, acronym: true },
    }),
    prisma.positionType.findMany({
      where: { deletedAt: null },
      orderBy: [{ hierarchyLevel: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    prisma.position.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      take: 500,
      select: { id: true, title: true },
    }),
  ]);

  return data({ organizations, types, reportsToCandidates, canDirect, draft });
}

export default function NewPosition({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/positions`;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("positions.new")}</h1>
        <p className="text-muted-foreground text-sm">{t("positions.newSubtitle")}</p>
      </header>
      <PositionEditor
        draftValues={loaderData.draft?.values}
        organizations={loaderData.organizations}
        types={loaderData.types}
        reportsToCandidates={loaderData.reportsToCandidates}
        canDirectApply={loaderData.canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
