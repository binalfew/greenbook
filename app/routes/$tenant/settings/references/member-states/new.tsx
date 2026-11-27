import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { listRegionalGroups } from "~/services/reference-data.server";
import { requireReferenceDataAdmin } from "~/utils/reference-data-access.server";
import { MemberStateEditor } from "./+shared/member-state-editor";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New" };

export { action } from "./+shared/member-state-editor.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireReferenceDataAdmin(request);
  const regionalGroups = await listRegionalGroups();
  return data({ regionalGroups });
}

export default function NewMemberState({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/member-states`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
      </header>
      <MemberStateEditor
        regionalGroups={loaderData.regionalGroups}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
