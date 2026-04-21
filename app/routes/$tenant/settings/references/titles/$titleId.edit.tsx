import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getTitle, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { TitleEditor } from "./+shared/title-editor";
import type { Route } from "./+types/$titleId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/title-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const title = await getTitle(params.titleId, tenantId);
    return data({ title });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditTitle({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/titles`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("titles")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.title.name}</p>
      </header>
      <TitleEditor title={loaderData.title} actionData={actionData} basePrefix={basePrefix} />
    </div>
  );
}
