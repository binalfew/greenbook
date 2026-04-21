import { useTranslation } from "react-i18next";
import { data, Form, useNavigate, useParams } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { rotateWebhookSecret } from "~/services/webhooks.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$webhookId.rotate-secret";

export const handle = { breadcrumb: "Rotate secret" };

export async function action({ request, params }: Route.ActionArgs) {
  const { tenantId } = await requireFeature(request, "FF_WEBHOOKS");
  const user = await requirePermission(request, "webhook", "write");
  const ctx = buildServiceContext(request, user, tenantId);
  const { secret } = await rotateWebhookSecret(params.webhookId, ctx);
  return data({ secret });
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireFeature(request, "FF_WEBHOOKS");
  return data({ secret: null as string | null });
}

export default function RotateSecretDialog({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation("webhooks");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const params = useParams();
  const base = `/${params.tenant}/settings/webhooks/${params.webhookId}`;
  const handleClose = () => navigate(base, { replace: true });
  const newSecret = actionData?.secret ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rotateSecret")}</DialogTitle>
        </DialogHeader>
        {newSecret ? (
          <>
            <p className="text-sm font-medium">{t("rotateSecretRevealed")}</p>
            <code className="bg-muted block rounded p-2 font-mono text-xs break-all">
              {newSecret}
            </code>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="w-full sm:w-auto"
              >
                {tc("close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t("rotateSecretWarning")}</p>
            <Form method="post">
              <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button type="submit" variant="destructive" className="w-full sm:w-auto">
                  {t("rotateSecret")}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
