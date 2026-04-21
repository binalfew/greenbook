import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getCountry, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { CountryEditor } from "./+shared/country-editor";
import type { Route } from "./+types/$countryId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/country-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const country = await getCountry(params.countryId, tenantId);
    return data({ country });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditCountry({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/countries`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("countries")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.country.name}</p>
      </header>
      <CountryEditor country={loaderData.country} actionData={actionData} basePrefix={basePrefix} />
    </div>
  );
}
