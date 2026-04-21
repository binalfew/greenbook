import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import { deleteCurrency, getCurrency, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$currencyId.delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "delete");
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

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "reference-data", "delete");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  const ctx = buildServiceContext(request, user, tenantId);
  await deleteCurrency(params.currencyId, ctx);
  return redirect(`/${params.tenant}/settings/references/currencies`);
}

export default function DeleteCurrency({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/references/currencies`;
  const d = loaderData.currency;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{tc("delete")}</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            {d.symbol && <span className="font-semibold">{d.symbol}</span>}
            {d.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label={t("code")}>
            <span className="font-mono text-xs">{d.code}</span>
          </InfoRow>
          <InfoRow label={t("decimalDigits")}>{d.decimalDigits}</InfoRow>
        </CardContent>
      </Card>
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-sm">{t("deleteConfirm")}</p>
        </CardContent>
      </Card>
      <Form method="post" className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" variant="destructive" className="w-full sm:w-auto">
          {tc("delete")}
        </Button>
        <Button variant="outline" asChild className="w-full sm:w-auto">
          <Link to={base}>{tc("cancel")}</Link>
        </Button>
      </Form>
    </div>
  );
}
