import { Check } from "lucide-react";
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
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { approveChange } from "~/services/directory-changes.server";
import { requireReviewContext } from "~/utils/directory-access.server";
import type { Route } from "./+types/$changeId.approve";

export const handle = { breadcrumb: "Approve" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireReviewContext(request);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const { ctx } = await requireReviewContext(request);
  const formData = await request.formData();
  const notes = String(formData.get("notes") ?? "").trim() || undefined;
  await approveChange(params.changeId, { notes }, ctx);
  return redirect(`/${params.tenant}/directory/approvals/${params.changeId}`);
}

export default function ApproveChangeDialog({ params }: Route.ComponentProps) {
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
            <Check className="text-primary size-5" />
            {t("changes.approveDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("changes.approveDialog.description")}</DialogDescription>
        </DialogHeader>

        <Form method="post" className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="notes">{t("changes.approveDialog.notesLabel")}</Label>
            <Textarea id="notes" name="notes" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit">{t("changes.approveDialog.confirm")}</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
