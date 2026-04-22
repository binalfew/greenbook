import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getRegionalGroup, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { RegionalGroupEditor } from "./+shared/regional-group-editor";
import type { Route } from "./+types/$regionId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/regional-group-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const regionalGroup = await getRegionalGroup(params.regionId, tenantId);
    return data({ regionalGroup });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditRegionalGroup({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/regional-groups`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("regionalGroups")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.regionalGroup.name}</p>
      </header>
      <RegionalGroupEditor
        regionalGroup={loaderData.regionalGroup}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
