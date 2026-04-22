import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getOrganizationType, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { OrganizationTypeEditor } from "./+shared/organization-type-editor";
import type { Route } from "./+types/$orgTypeId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/organization-type-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const organizationType = await getOrganizationType(params.orgTypeId, tenantId);
    return data({ organizationType });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditOrganizationType({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/organization-types`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("organizationTypes")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.organizationType.name}</p>
      </header>
      <OrganizationTypeEditor
        organizationType={loaderData.organizationType}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
