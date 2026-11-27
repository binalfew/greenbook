import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoRow } from "~/components/ui/info-row";
import {
  deleteMemberState,
  getMemberState,
  ReferenceDataError,
} from "~/services/reference-data.server";
import { requireReferenceDataAdmin } from "~/utils/reference-data-access.server";
import type { Route } from "./+types/$memberStateId.delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireReferenceDataAdmin(request);
  try {
    const memberState = await getMemberState(params.memberStateId);
    return data({ memberState });
  } catch (err) {
    if (err instanceof ReferenceDataError) {
      throw data({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireReferenceDataAdmin(request);
  await deleteMemberState(params.memberStateId);
  return redirect(`/${params.tenant}/settings/references/member-states`);
}

export default function DeleteMemberState({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("references");
  const { t: tc } = useTranslation("common");
  const base = `/${params.tenant}/settings/references/member-states`;
  const d = loaderData.memberState;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{tc("delete")}</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{d.fullName}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label={t("abbreviation")}>
            <span className="font-mono text-xs">{d.abbreviation}</span>
          </InfoRow>
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
