import { useTranslation } from "react-i18next";
import { data } from "react-router";
import {
  getMemberState,
  listRegionalGroups,
  ReferenceDataError,
} from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { MemberStateEditor } from "./+shared/member-state-editor";
import type { Route } from "./+types/$memberStateId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/member-state-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const [memberState, regionalGroups] = await Promise.all([
      getMemberState(params.memberStateId, tenantId),
      listRegionalGroups(tenantId),
    ]);
    return data({ memberState, regionalGroups });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditMemberState({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/member-states`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("memberStates")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.memberState.fullName}</p>
      </header>
      <MemberStateEditor
        memberState={loaderData.memberState}
        regionalGroups={loaderData.regionalGroups}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
