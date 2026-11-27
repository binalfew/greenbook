import { Undo2 } from "lucide-react";
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
import { withdrawChange } from "~/services/directory-changes.server";
import { requireSubmitContext } from "~/utils/directory-access.server";
import { directoryDialogConflict } from "~/utils/directory-submit.server";
import { submissionPath, submissionsPath } from "~/utils/directory-routes";
import type { Route } from "./+types/$changeId.withdraw";

export const handle = { breadcrumb: "Withdraw" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireSubmitContext(request);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const { ctx } = await requireSubmitContext(request);
  try {
    await withdrawChange(params.changeId, ctx);
  } catch (err) {
    return data({ error: directoryDialogConflict(request, err).message }, { status: 409 });
  }
  return redirect(submissionsPath(params.tenant));
}

export default function WithdrawChangeDialog({ params, actionData }: Route.ComponentProps) {
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
            <Undo2 className="size-5" />
            {t("changes.withdrawDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("changes.withdrawDialog.description")}</DialogDescription>
        </DialogHeader>

        <Form method="post" className="space-y-4">
          <FormError message={actionData?.error} />
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit">{t("changes.withdrawDialog.confirm")}</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
