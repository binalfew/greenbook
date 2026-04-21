import { parseWithZod } from "@conform-to/zod/v4";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigate, useParams } from "react-router";
import {
  SelectField,
  getFormProps,
  getInputProps,
  getTextareaProps,
  useForm,
} from "~/components/form";
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
import { assignPersonFormSchema } from "~/utils/schemas/directory";
import type { Route } from "./+types/$positionId.assign";

export const handle = { breadcrumb: "Assign" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, tenantId, canSubmit } = await requireDirectoryAccess(request);
  const canDirect = hasPermission(user, "position-assignment", "write");
  if (!canDirect && !canSubmit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const [position, people] = await Promise.all([
    prisma.position.findFirst({
      where: { id: params.positionId, tenantId, deletedAt: null },
      select: { id: true, title: true },
    }),
    prisma.person.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
      select: { id: true, firstName: true, lastName: true, honorific: true },
    }),
  ]);
  if (!position) throw new Response("Not Found", { status: 404 });

  return data({ position, people, canDirect });
}

export async function action({ request, params }: Route.ActionArgs) {
  const submission = parseWithZod(await request.formData(), {
    schema: assignPersonFormSchema,
  });
  if (submission.status !== "success") {
    return data(submission.reply(), {
      status: submission.status === "error" ? 400 : 200,
    });
  }

  const { positionId, personId, startDate, notes } = submission.value;

  await dispatchDirectoryChange(request, "position-assignment", {
    entityType: "POSITION_ASSIGNMENT",
    operation: "CREATE",
    payload: {
      positionId,
      personId,
      startDate,
      notes,
    },
  });

  return redirect(`/${params.tenant}/directory/positions/${params.positionId}`);
}

export default function AssignPersonDialog({
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

  const { form, fields } = useForm(assignPersonFormSchema, {
    lastResult: actionData,
    defaultValue: {
      positionId: loaderData.position.id,
      personId: "",
      startDate: new Date().toISOString().slice(0, 10),
      notes: "",
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5" />
            {t("assignments.assignPerson")}
          </DialogTitle>
          <DialogDescription>{t("assignments.assignSubtitle")}</DialogDescription>
        </DialogHeader>

        <Form method="post" {...getFormProps(form)} className="space-y-3">
          <input
            {...getInputProps(fields.positionId, { type: "hidden" })}
            key={fields.positionId.key}
          />

          <div className="space-y-2">
            <Label htmlFor={fields.personId.id}>{t("assignments.fields.person")}</Label>
            <SelectField
              meta={fields.personId}
              options={loaderData.people.map((p) => ({
                value: p.id,
                label: `${p.honorific ? `${p.honorific} ` : ""}${p.firstName} ${p.lastName}`,
              }))}
              placeholder={t("assignments.fields.personPlaceholder")}
            />
            {fields.personId.errors && fields.personId.errors.length > 0 ? (
              <p className="text-destructive text-xs">{fields.personId.errors[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.startDate.id}>{t("assignments.fields.startDate")}</Label>
            <Input
              {...getInputProps(fields.startDate, { type: "date" })}
              key={fields.startDate.key}
            />
            {fields.startDate.errors && fields.startDate.errors.length > 0 ? (
              <p className="text-destructive text-xs">{fields.startDate.errors[0]}</p>
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
            <Button type="submit">
              {loaderData.canDirect ? t("actions.submitAndApprove") : t("actions.submit")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
