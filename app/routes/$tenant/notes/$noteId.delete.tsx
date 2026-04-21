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
import { deleteNote, getNote } from "~/services/notes.server";
import { requireFeature, requirePermission } from "~/utils/auth/require-auth.server";
import { buildServiceContext } from "~/utils/request-context.server";
import type { Route } from "./+types/$noteId.delete";

export const handle = { breadcrumb: "Delete" };

// Dialog delete — rendered inside the $noteId._layout.tsx Outlet so the
// detail page stays visible behind the overlay. Closing navigates back.

export async function loader({ request, params }: Route.LoaderArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  const note = await getNote(params.noteId, tenantId);
  return data({ note: { id: note.id, title: note.title } });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { tenantId } = await requireFeature(request, "FF_NOTES");
  const user = await requirePermission(request, "note", "delete");
  const ctx = buildServiceContext(request, user, tenantId);

  await deleteNote(params.noteId, ctx);
  return redirect(`/${params.tenant}/notes`);
}

export default function DeleteNoteDialog({ loaderData, params }: Route.ComponentProps) {
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
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-5" />
            {t("deleteTitle")}
          </DialogTitle>
          <DialogDescription>{t("deleteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("title")}</span>{" "}
          <span className="font-medium">{loaderData.note.title}</span>
        </div>

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
