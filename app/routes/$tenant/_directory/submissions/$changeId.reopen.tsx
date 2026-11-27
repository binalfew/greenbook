import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigate } from "react-router";
import { FormError } from "~/components/directory/form-error";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { reopenRejectedChange } from "~/services/directory-changes.server";
import { requireSubmitContext } from "~/utils/directory-access.server";
import { submissionPath, draftEditPath } from "~/utils/directory-routes";
import { directoryDialogConflict } from "~/utils/directory-submit.server";
import type { Route } from "./+types/$changeId.reopen";

export const handle = { breadcrumb: "Reopen" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireSubmitContext(request);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const { ctx } = await requireSubmitContext(request);
  try {
    const draft = await reopenRejectedChange(params.changeId, ctx);
    // Straight into the editor, where the rejection notes are shown. Requests
    // without an editor (delete, move, assignments) land on the draft itself.
    return redirect(draftEditPath(params.tenant, draft) ?? submissionPath(params.tenant, draft.id));
  } catch (err) {
    return data({ error: directoryDialogConflict(request, err).message }, { status: 409 });
  }
}

export default function ReopenChangeDialog({ params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const base = submissionPath(params.tenant, params.changeId);
  const handleClose = () => navigate(base, { replace: true });

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-5" />
            {t("changes.reopenDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("changes.reopenDialog.description")}</DialogDescription>
        </DialogHeader>

        <Form method="post" className="space-y-4">
          <FormError message={actionData?.error} />
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit">{t("changes.reopenDialog.confirm")}</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
