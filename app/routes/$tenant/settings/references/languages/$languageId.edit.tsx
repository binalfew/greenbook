import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getLanguage, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { LanguageEditor } from "./+shared/language-editor";
import type { Route } from "./+types/$languageId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/language-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const language = await getLanguage(params.languageId, tenantId);
    return data({ language });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditLanguage({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/languages`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("languages")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.language.name}</p>
      </header>
      <LanguageEditor
        language={loaderData.language}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
