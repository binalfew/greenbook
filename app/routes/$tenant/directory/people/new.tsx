import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { prisma } from "~/utils/db/db.server";
import { requireDirectoryWriteAccess } from "~/utils/directory-access.server";
import { PersonEditor } from "./+shared/person-editor";
import type { Route } from "./+types/new";

export { action } from "./+shared/person-editor.server";

export const handle = { breadcrumb: "New" };

export async function loader({ request }: Route.LoaderArgs) {
  const { tenantId, canDirect } = await requireDirectoryWriteAccess(request, "person");

  const memberStates = await prisma.memberState.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, abbreviation: true },
  });

  return data({ memberStates, canDirect });
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
        memberStates={loaderData.memberStates}
        canDirectApply={loaderData.canDirect}
        basePrefix={base}
        actionData={actionData}
      />
    </div>
  );
}
