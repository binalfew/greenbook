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
import { deleteComment } from "~/services/notes.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$noteId.comments.$commentId.delete";

export const handle = { breadcrumb: "Delete comment" };

export async function action({ request, params }: Route.ActionArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  const user = await requirePermission(request, "note", "write");
  const ctx = buildServiceContext(request, user, tenantId);

  await deleteComment(params.commentId, ctx);
  return redirect(`/${params.tenant}/notes/${params.noteId}`);
}

export default function DeleteCommentDialog({ params }: Route.ComponentProps) {
  const { t } = useTranslation("notes");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/notes/${params.noteId}`;
  const handleClose = () => navigate(base, { replace: true });

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteCommentTitle")}</DialogTitle>
          <DialogDescription>{t("deleteCommentDescription")}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} type="button">
            {tc("cancel")}
          </Button>
          <Form method="post">
            <Button type="submit" variant="destructive">
              {tc("delete")}
            </Button>
          </Form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
