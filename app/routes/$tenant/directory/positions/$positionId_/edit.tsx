import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getPosition } from "~/services/positions.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { PositionEditor } from "../+shared/position-editor";
import type { Route } from "./+types/edit";

export { action } from "../+shared/position-editor.server";

export const handle = { breadcrumb: "Edit" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId, canDirect } = await requireDirectoryWriteAccess(request, "position");

  const [position, organizations, types, reportsToCandidates] = await Promise.all([
    getPosition(params.positionId, tenantId),
    prisma.organization.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, acronym: true },
    }),
    prisma.positionType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ hierarchyLevel: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    prisma.position.findMany({
      where: { tenantId, deletedAt: null, isActive: true, id: { not: params.positionId } },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      take: 500,
      select: { id: true, title: true },
    }),
  ]);

  return data({ position, organizations, types, reportsToCandidates, canDirect });
}

export default function EditPosition({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/positions`;
  const { position, organizations, types, reportsToCandidates, canDirect } = loaderData;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("positions.edit")}</h1>
        <p className="text-muted-foreground text-sm">{t("positions.editSubtitle")}</p>
      </header>
      <PositionEditor
        position={position}
        organizations={organizations}
        types={types}
        reportsToCandidates={reportsToCandidates}
        canDirectApply={canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
