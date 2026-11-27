import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { RejectionNotes } from "~/components/directory/rejection-notes";
import { getPerson } from "~/services/people.server";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { loadEditorDraft } from "~/utils/directory-submit.server";
import { PersonEditor } from "../+shared/person-editor";
import type { Route } from "./+types/edit";

export { action } from "../+shared/person-editor.server";

export const handle = { breadcrumb: "Edit" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const access = await requireDirectoryWriteAccess(request, "person");
  const { tenantId, canDirect } = access;
  const draft = await loadEditorDraft(request, access, "PERSON", params.personId);

  const [person, memberStates, titles] = await Promise.all([
    getPerson(params.personId, tenantId),
    prisma.memberState.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, abbreviation: true },
    }),
    prisma.title.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return data({ person, memberStates, titles, canDirect, draft });
}

export default function EditPerson({ loaderData, params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const base = `/${params.tenant}/directory/people`;
  const { person, memberStates, titles, canDirect } = loaderData;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("people.edit")}</h1>
        <p className="text-muted-foreground text-sm">{t("people.editSubtitle")}</p>
      </header>
      <RejectionNotes rejection={loaderData.draft?.rejection} tenant={params.tenant} />
      <PersonEditor
        person={person}
        draftValues={loaderData.draft?.values}
        memberStates={memberStates}
        titles={titles}
        canDirectApply={canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
