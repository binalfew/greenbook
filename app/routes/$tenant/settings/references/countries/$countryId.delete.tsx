import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import { deleteCountry, getCountry, ReferenceDataError } from "~/services/reference-data.server";
import { requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$countryId.delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, "reference-data", "delete");
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

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, "reference-data", "delete");
  const tenantId = user.tenantId;
  if (!tenantId) {
    throw data({ error: "Missing tenant context" }, { status: 403 });
  }
  const ctx = buildServiceContext(request, user, tenantId);
  await deleteCountry(params.countryId, ctx);
  return redirect(`/${params.tenant}/settings/references/countries`);
}

export default function DeleteCountry({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/references/countries`;
  const c = loaderData.country;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{tc("delete")}</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            {c.flag && <span className="text-lg">{c.flag}</span>}
            {c.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label={t("code")}>
            <span className="font-mono text-xs">{c.code}</span>
          </InfoRow>
          {c.alpha3 && (
            <InfoRow label={t("alpha3")}>
              <span className="font-mono text-xs">{c.alpha3}</span>
            </InfoRow>
          )}
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
