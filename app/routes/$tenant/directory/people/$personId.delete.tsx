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
import type { Route } from "./+types/$personId.delete";

export const handle = { breadcrumb: "Delete" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  const canDirect = hasPermission(user, "person", "delete");
  if (!canDirect && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const person = await prisma.person.findFirst({
    where: { id: params.personId, tenantId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      _count: { select: { assignments: { where: { deletedAt: null, isCurrent: true } } } },
    },
  });
  if (!person) throw new Response("Not Found", { status: 404 });

  return data({
    person: {
      id: person.id,
      name: `${person.firstName} ${person.lastName}`,
      assignmentCount: person._count.assignments,
    },
    canDirect,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  await dispatchDirectoryDelete(request, "person", "PERSON", params.personId, reason);
  return redirect(`/${params.tenant}/directory/people`);
}

export default function DeletePersonDialog({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/directory/people/${params.personId}`;
  const handleClose = () => navigate(base, { replace: true });
  const buttonLabel = loaderData.canDirect
    ? t("people.deleteButtonDirect")
    : t("people.deleteButton");

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-5" />
            {t("people.deleteTitle")}
          </DialogTitle>
          <DialogDescription>{t("people.deleteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="font-medium">{loaderData.person.name}</span>
        </div>

        {loaderData.person.assignmentCount > 0 ? (
          <p className="text-destructive text-sm">
            {t("people.deleteBlockedAssignments", { count: loaderData.person.assignmentCount })}
          </p>
        ) : null}

        <Form method="post" className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="reason">{t("people.deleteReasonLabel")}</Label>
            <Textarea id="reason" name="reason" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={loaderData.person.assignmentCount > 0}
            >
              {buttonLabel}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
