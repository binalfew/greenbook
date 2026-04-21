import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { getCurrency, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { CurrencyEditor } from "./+shared/currency-editor";
import type { Route } from "./+types/$currencyId.edit";

export const handle = { breadcrumb: "Edit" };

export { action } from "./+shared/currency-editor.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "write");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  try {
    const currency = await getCurrency(params.currencyId, tenantId);
    return data({ currency });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export default function EditCurrency({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const basePrefix = `/${params.tenant}/settings/references/currencies`;
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("currencies")}</h1>
        <p className="text-muted-foreground text-sm">{loaderData.currency.name}</p>
      </header>
      <CurrencyEditor
        currency={loaderData.currency}
        actionData={actionData}
        basePrefix={basePrefix}
      />
    </div>
  );
}
