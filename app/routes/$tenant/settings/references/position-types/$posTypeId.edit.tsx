import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getPositionType, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { PositionTypeEditor } from "./+shared/position-type-editor";
import type { Route } from "./+types/$posTypeId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/position-type-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const positionType = await getPositionType(params.posTypeId, tenantId);
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
