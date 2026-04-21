import { parseWithZod } from "@conform-to/zod/v4";
import { UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigate, useParams } from "react-router";
import { getFormProps, getInputProps, getTextareaProps, useForm } from "~/components/form";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { prisma } from "~/utils/db/db.server";
import { hasPermission } from "~/utils/auth/require-auth.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { endAssignmentFormSchema } from "~/utils/schemas/directory";
import { formatDateInput } from "~/utils/format-date";
import type { Route } from "./+types/$positionId.assignments.$assignmentId.end";

export const handle = { breadcrumb: "End" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  const canDirect = hasPermission(user, "position-assignment", "write");
  if (!canDirect && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const assignment = await prisma.positionAssignment.findFirst({
    where: {
      id: params.assignmentId,
      positionId: params.positionId,
      tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      positionId: true,
      personId: true,
      startDate: true,
      notes: true,
      person: { select: { firstName: true, lastName: true, honorific: true } },
      position: { select: { title: true } },
    },
  });
  if (!assignment) throw new Response("Not Found", { status: 404 });

  return data({ assignment, canDirect });
}

export async function action({ request, params }: Route.ActionArgs) {
  const submission = parseWithZod(await request.formData(), {
    schema: endAssignmentFormSchema,
  });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const { id, positionId, personId, startDate, endDate, notes } = submission.value;

  await dispatchDirectoryChange(request, "position-assignment", {
    entityType: "POSITION_ASSIGNMENT",
    operation: "UPDATE",
    entityId: id,
    payload: {
      positionId,
      personId,
      startDate,
      endDate,
      notes,
    },
  });

  return redirect(`/${params.tenant}/directory/positions/${params.positionId}`);
}

export default function EndAssignmentDialog({
  loaderData,
  params,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation("directory");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const { tenant } = useParams();
  const base = `/${tenant}/directory/positions/${params.positionId}`;
  const handleClose = () => navigate(base, { replace: true });
  const { assignment } = loaderData;

  const { form, fields } = useForm(endAssignmentFormSchema, {
    lastResult: actionData,
    defaultValue: {
      id: assignment.id,
      positionId: assignment.positionId,
      personId: assignment.personId,
      startDate: formatDateInput(assignment.startDate),
      endDate: new Date().toISOString().slice(0, 10),
      notes: assignment.notes ?? "",
    },
  });

  const holderName = `${assignment.person.honorific ? `${assignment.person.honorific} ` : ""}${assignment.person.firstName} ${assignment.person.lastName}`;

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="size-5" />
            {t("assignments.endAssignment")}
          </DialogTitle>
          <DialogDescription>{t("assignments.endSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="font-medium">{holderName}</span>
          <span className="text-muted-foreground"> — {assignment.position.title}</span>
        </div>

        <Form method="post" {...getFormProps(form)} className="space-y-3">
          <input {...getInputProps(fields.id, { type: "hidden" })} key={fields.id.key} />
          <input
            {...getInputProps(fields.positionId, { type: "hidden" })}
            key={fields.positionId.key}
          />
          <input
            {...getInputProps(fields.personId, { type: "hidden" })}
            key={fields.personId.key}
          />
          <input
            {...getInputProps(fields.startDate, { type: "hidden" })}
            key={fields.startDate.key}
          />

          <div className="space-y-2">
            <Label htmlFor={fields.endDate.id}>{t("assignments.fields.endDate")}</Label>
            <Input {...getInputProps(fields.endDate, { type: "date" })} key={fields.endDate.key} />
            {fields.endDate.errors && fields.endDate.errors.length > 0 ? (
              <p className="text-destructive text-xs">{fields.endDate.errors[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.notes.id}>{t("assignments.fields.notes")}</Label>
            <Textarea {...getTextareaProps(fields.notes)} key={fields.notes.key} rows={3} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} type="button">
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="destructive">
              {loaderData.canDirect ? t("actions.submitAndApprove") : t("actions.submit")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
