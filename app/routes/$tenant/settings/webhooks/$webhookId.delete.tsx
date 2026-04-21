import { useTranslation } from "react-i18next";
import { data, Form, redirect, useNavigate, useParams } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { deleteWebhookSubscription } from "~/services/webhooks.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$webhookId.delete";

export const handle = { breadcrumb: "Delete" };

export async function action({ request, params }: Route.ActionArgs) {
  const { tenantId } = await requireFeature(request, "FF_WEBHOOKS");
  const user = await requirePermission(request, "webhook", "delete");
  const ctx = buildServiceContext(request, user, tenantId);
  await deleteWebhookSubscription(params.webhookId, ctx);
  return redirect(`/${params.tenant}/settings/webhooks`);
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireFeature(request, "FF_WEBHOOKS");
  return data({});
}

export default function DeleteWebhookDialog() {
  const { t } = useTranslation("webhooks");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const params = useParams();
  const base = `/${params.tenant}/settings/webhooks/${params.webhookId}`;
  const handleClose = () => navigate(base, { replace: true });

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteSubscription")}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t("deleteConfirm")}</p>
        <Form method="post">
          <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="destructive" className="w-full sm:w-auto">
              {tc("delete")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="w-full sm:w-auto"
            >
              {tc("cancel")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
