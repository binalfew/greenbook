import { Trash2 } from "lucide-react";
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
import { ChangeRequestError, discardDraft } from "~/services/directory-changes.server";
import { requireSubmitContext } from "~/utils/directory-access.server";
import { draftsPath } from "~/utils/directory-routes";
import type { Route } from "./+types/$changeId.discard";

export const handle = { breadcrumb: "Discard" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireSubmitContext(request);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const { ctx } = await requireSubmitContext(request);
  try {
    await discardDraft(params.changeId, ctx);
  } catch (error) {
    if (error instanceof ChangeRequestError && error.code === "NOT_FOUND") {
      throw new Response("Not Found", { status: 404 });
    }
    throw error;
  }
  return redirect(draftsPath(params.tenant));
}

export default function DiscardDraftDialog({ params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/directory/approvals/${params.changeId}`;
  const handleClose = () => navigate(base, { replace: true });

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="text-destructive size-5" />
            {t("changes.discardDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("changes.discardDialog.description")}</DialogDescription>
        </DialogHeader>

        <Form method="post">
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="destructive">
              {t("changes.discardDialog.confirm")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
