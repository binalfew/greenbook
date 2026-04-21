import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { CountryEditor } from "./+shared/country-editor";
import type { Route } from "./+types/new";

export const handle = { breadcrumb: "New" };

export { action } from "./+shared/country-editor.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, "reference-data", "write");
  return data({});
}

export default function NewCountry({ actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/countries`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
      </header>
      <CountryEditor actionData={actionData} basePrefix={basePrefix} />
    </div>
  );
}
