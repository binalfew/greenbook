import { parseWithZod } from "@conform-to/zod/v4";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigate, useParams } from "react-router";
import { getFormProps, getTextareaProps, useForm } from "~/components/form";
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
import { rejectChange } from "~/services/directory-changes.server";
import { requireReviewContext } from "~/utils/directory-access.server";
import { rejectChangeSchema } from "~/utils/schemas/directory";
import type { Route } from "./+types/$changeId.reject";

export const handle = { breadcrumb: "Reject" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireReviewContext(request);
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const { ctx } = await requireReviewContext(request);
  const submission = parseWithZod(await request.formData(), { schema: rejectChangeSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }
  await rejectChange(params.changeId, { notes: submission.value.notes }, ctx);
  return redirect(`/${params.tenant}/directory/approvals/${params.changeId}`);
}

export default function RejectChangeDialog({ params, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/directory/approvals/${params.changeId}`;
  const handleClose = () => navigate(base, { replace: true });

  const { form, fields } = useForm(rejectChangeSchema, {
    lastResult: actionData,
    defaultValue: { notes: "" },
  });
  const notesError = fields.notes.errors?.[0];

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="text-destructive size-5" />
            {t("changes.rejectDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("changes.rejectDialog.description")}</DialogDescription>
        </DialogHeader>

        <Form method="post" {...getFormProps(form)} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={fields.notes.id}>{t("changes.rejectDialog.notesLabel")}</Label>
            <Textarea {...getTextareaProps(fields.notes)} key={fields.notes.key} rows={3} />
            {notesError ? <p className="text-destructive text-xs">{notesError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="destructive">
              {t("changes.rejectDialog.confirm")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
