import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getPositionType, ReferenceDataError } from "~/services/reference-data.server";
import { requireReferenceDataAdmin } from "~/utils/reference-data-access.server";
import { PositionTypeEditor } from "./+shared/position-type-editor";
import type { Route } from "./+types/$posTypeId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/position-type-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireReferenceDataAdmin(request);
  try {
    const positionType = await getPositionType(params.posTypeId);
    return data({ positionType });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditPositionType({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/position-types`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("positionTypes")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.positionType.name}</p>
      </header>
      <PositionTypeEditor
        positionType={loaderData.positionType}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
