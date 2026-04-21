import { parseWithZod } from "@conform-to/zod/v4";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigate, useParams } from "react-router";
import { getFormProps, getTextareaProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { addComment } from "~/services/notes.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import { commentFormSchema } from "~/utils/schemas/notes";
import type { Route } from "./+types/$noteId.comments.new";

export const handle = { breadcrumb: "Add comment" };

export async function loader({ request }: Route.LoaderArgs) {
  await requireFeature(request, "FF_NOTES");
  return data({});
}

export async function action({ request, params }: Route.ActionArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  const user = await requirePermission(request, "note", "write");

  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: commentFormSchema });
  if (submission.status !== "success") {
    return data(submission.reply(), { status: 400 });
  }

  const ctx = buildServiceContext(request, user, tenantId);
  await addComment(params.noteId, submission.value, ctx);
  return redirect(`/${params.tenant}/notes/${params.noteId}`);
}

export default function NewCommentDialog({ actionData, params }: Route.ComponentProps) {
  const { t } = useTranslation("notes");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/notes/${params.noteId}`;
  const handleClose = () => navigate(base, { replace: true });

  const { form, fields } = useForm(commentFormSchema, { lastResult: actionData });

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addComment")}</DialogTitle>
        </DialogHeader>

        <Form method="post" {...getFormProps(form)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={fields.body.id}>{t("commentBody")}</Label>
            <Textarea
              {...getTextareaProps(fields.body)}
              key={fields.body.key}
              rows={5}
              placeholder={t("commentPlaceholder")}
            />
            {fields.body.errors && fields.body.errors.length > 0 && (
              <p className="text-destructive text-sm">{fields.body.errors[0]}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit">{t("postComment")}</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
