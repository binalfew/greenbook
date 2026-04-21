import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigate, useParams } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { getOrganizationForDelete } from "~/services/organizations.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { dispatchDirectoryDelete } from "~/utils/directory-submit.server";
import type { Route } from "./+types/$orgId.delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  // Managers hold `organization:delete`, focal persons only `directory-change:submit`.
  // Either is enough to reach this page — the engine routes the actual write
  // through the right path.
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  const canDirect = hasPermission(user, "organization", "delete");
  if (!canDirect && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }
  const org = await getOrganizationForDelete(params.orgId, tenantId);
  return data({
    org: { id: org.id, name: org.name, childCount: org._count.children },
    canDirect,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  await dispatchDirectoryDelete(request, "organization", "ORGANIZATION", params.orgId, reason);
  return redirect(`/${params.tenant}/directory/organizations`);
}

export default function DeleteOrganizationDialog({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/directory/organizations/${params.orgId}`;
  const handleClose = () => navigate(base, { replace: true });
  const buttonLabel = loaderData.canDirect
    ? t("organizations.deleteButtonDirect")
    : t("organizations.deleteButton");

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-5" />
            {t("organizations.deleteTitle")}
          </DialogTitle>
          <DialogDescription>{t("organizations.deleteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("organizations.fields.name")}</span>{" "}
          <span className="font-medium">{loaderData.org.name}</span>
        </div>

        {loaderData.org.childCount > 0 ? (
          <p className="text-destructive text-sm">
            {t("organizations.deleteBlockedChildren", { count: loaderData.org.childCount })}
          </p>
        ) : null}

        <Form method="post" className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="reason">{t("organizations.deleteReasonLabel")}</Label>
            <Textarea id="reason" name="reason" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={loaderData.org.childCount > 0}>
              {buttonLabel}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
