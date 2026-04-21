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
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { prisma } from "~/utils/db/db.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { dispatchDirectoryDelete } from "~/utils/directory-submit.server";
import type { Route } from "./+types/$positionId.delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  const canDirect = hasPermission(user, "position", "delete");
  if (!canDirect && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const position = await prisma.position.findFirst({
    where: { id: params.positionId, tenantId, deletedAt: null },
    select: {
      id: true,
      title: true,
      _count: { select: { assignments: { where: { deletedAt: null, isCurrent: true } } } },
    },
  });
  if (!position) throw new Response("Not Found", { status: 404 });

  return data({
    position: {
      id: position.id,
      title: position.title,
      assignmentCount: position._count.assignments,
    },
    canDirect,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  await dispatchDirectoryDelete(request, "position", "POSITION", params.positionId, reason);
  return redirect(`/${params.tenant}/directory/positions`);
}

export default function DeletePositionDialog({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/directory/positions/${params.positionId}`;
  const handleClose = () => navigate(base, { replace: true });
  const buttonLabel = loaderData.canDirect
    ? t("positions.deleteButtonDirect")
    : t("positions.deleteButton");

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-5" />
            {t("positions.deleteTitle")}
          </DialogTitle>
          <DialogDescription>{t("positions.deleteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="font-medium">{loaderData.position.title}</span>
        </div>

        {loaderData.position.assignmentCount > 0 ? (
          <p className="text-destructive text-sm">
            {t("positions.deleteBlockedAssignments", {
              count: loaderData.position.assignmentCount,
            })}
          </p>
        ) : null}

        <Form method="post" className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="reason">{t("positions.deleteReasonLabel")}</Label>
            <Textarea id="reason" name="reason" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={loaderData.position.assignmentCount > 0}
            >
              {buttonLabel}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
