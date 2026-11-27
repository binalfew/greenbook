import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { loadEditorDraft } from "~/utils/directory-submit.server";
import { PersonEditor } from "./+shared/person-editor";
import type { Route } from "./+types/new";

export { action } from "./+shared/person-editor.server";

export const handle = { breadcrumb: "New" };

export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireDirectoryWriteAccess(request, "person");
  const { tenantId, canDirect } = access;
  const draft = await loadEditorDraft(request, access, "PERSON");

  const [memberStates, positions, titles] = await Promise.all([
    prisma.memberState.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, abbreviation: true },
    }),
    prisma.position.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: [{ title: "asc" }],
      take: 500,
      select: {
        id: true,
        title: true,
        organization: { select: { name: true, acronym: true } },
      },
    }),
    prisma.title.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return data({ memberStates, positions, titles, canDirect, draft });
}

export default function NewPerson({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/people`;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("people.new")}</h1>
        <p className="text-muted-foreground text-sm">{t("people.newSubtitle")}</p>
      </header>
      <PersonEditor
        draftValues={loaderData.draft?.values}
        memberStates={loaderData.memberStates}
        positions={loaderData.positions}
        titles={loaderData.titles}
        canDirectApply={loaderData.canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
